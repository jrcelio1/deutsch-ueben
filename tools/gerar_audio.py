#!/usr/bin/env python3
"""
Gera os áudios de pronúncia do app.

Para cada palavra/frase listada no campo "audio" das questões (data/modulo-*.js):
  1. procura uma gravação de falante real no Wikimedia Commons
     (arquivos "De-<palavra>.ogg" e gravações do Lingua Libre);
  2. se não houver, gera o áudio com o Piper (voz alemã "Thorsten");
  3. registra tudo em audio/manifest.js, com autor e licença para a aba Créditos.

Só processa o que ainda não está no manifest, então rodar de novo é rápido.
Normalmente quem roda isto é o GitHub Actions (.github/workflows/audio.yml).

Opções:
  --sem-wikimedia   não procura gravações humanas
  --sem-piper       não gera voz sintética
  --rebuscar        procura de novo gravação humana para o que hoje é voz sintética
"""
import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import wave
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "data"
PASTA_AUDIO = RAIZ / "audio"
MANIFEST = PASTA_AUDIO / "manifest.js"
CACHE_VOZ = RAIZ / ".cache-voz"

UA = "DeutschUeben/1.0 (app pessoal de estudo de alemao; GitHub Pages)"
API_COMMONS = "https://commons.wikimedia.org/w/api.php"
VOZES_PIPER = ["de_DE-thorsten-high", "de_DE-thorsten-medium"]
URL_VOZ = "https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/{nome}/{qualidade}/de_DE-{nome}-{qualidade}{ext}?download=true"
EXTENSOES = ("ogg", "oga", "wav", "opus", "flac", "mp3")


# ---------- utilidades ----------

def slug(texto):
    """Mesma regra de js/app.js — não altere uma sem a outra."""
    t = unicodedata.normalize("NFC", texto).lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        t = t.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def ler_objeto_js(caminho):
    s = caminho.read_text(encoding="utf-8")
    return json.loads(s[s.index("{"): s.rindex("}") + 1])


def textos_das_questoes():
    vistos = {}
    for arq in sorted(DADOS.glob("modulo-*.js")):
        for q in ler_objeto_js(arq)["questoes"]:
            for t in q.get("audio", []):
                vistos.setdefault(slug(t), t)
    return vistos


def ler_manifest():
    if not MANIFEST.exists():
        return {}
    return ler_objeto_js(MANIFEST)


def salvar_manifest(m):
    corpo = json.dumps(m, ensure_ascii=False, indent=1, sort_keys=True)
    MANIFEST.write_text(
        "// Gerado automaticamente por tools/gerar_audio.py. Não edite à mão.\n"
        "window.AUDIO_MANIFEST = " + corpo + ";\n",
        encoding="utf-8",
    )


def limpar_html(t):
    t = re.sub(r"<[^>]+>", " ", t or "")
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


def baixar(url, destino):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r, open(destino, "wb") as f:
        shutil.copyfileobj(r, f)


def para_mp3(origem, destino, normalizar=True):
    """Converte para MP3 (toca em qualquer navegador). Sem ffmpeg, mantém o original."""
    if not shutil.which("ffmpeg"):
        final = destino.with_suffix(origem.suffix)
        if origem != final:
            shutil.move(origem, final)
        return final
    filtro = ["-af", "loudnorm=I=-18:TP=-2"] if normalizar else []
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(origem), *filtro,
         "-ac", "1", "-ar", "44100", "-b:a", "64k", str(destino)],
        check=True,
    )
    origem.unlink(missing_ok=True)
    return destino


# ---------- Wikimedia Commons ----------

def api(params):
    params = dict(params, format="json", formatversion="2")
    url = API_COMMONS + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        dados = json.load(r)
    time.sleep(0.3)  # gentileza com o servidor
    return dados


def variantes(texto):
    base = texto.strip().rstrip("!?.").strip()
    if not base:
        return []
    out = [base]
    for v in (base[0].upper() + base[1:], base[0].lower() + base[1:]):
        if v not in out:
            out.append(v)
    return out


def info_arquivos(titulos):
    """Devolve {titulo_pedido: info} só para arquivos que existem."""
    dados = api({
        "action": "query",
        "titles": "|".join(titulos),
        "prop": "imageinfo",
        "iiprop": "url|mime|extmetadata",
        "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl",
    })
    q = dados.get("query", {})
    normal = {n["from"]: n["to"] for n in q.get("normalized", [])}
    paginas = {p["title"]: p for p in q.get("pages", [])}
    achados = {}
    for t in titulos:
        p = paginas.get(normal.get(t, t))
        if not p or p.get("missing") or not p.get("imageinfo"):
            continue
        ii = p["imageinfo"][0]
        if not str(ii.get("mime", "")).startswith(("audio/", "application/ogg", "video/ogg")):
            continue
        meta = ii.get("extmetadata", {})
        achados[t] = {
            "titulo": p["title"],
            "url": ii["url"],
            "pagina": ii.get("descriptionurl", ""),
            "autor": limpar_html(meta.get("Artist", {}).get("value", "")),
            "licenca": limpar_html(meta.get("LicenseShortName", {}).get("value", "")),
            "licencaUrl": meta.get("LicenseUrl", {}).get("value", ""),
        }
    return achados


def buscar_commons(texto):
    vs = variantes(texto)
    if not vs:
        return None
    # 1) Convenção clássica do Commons: "De-<palavra>.ogg"
    candidatos = [f"File:De-{v}.{ext}" for v in vs for ext in EXTENSOES]
    achados = info_arquivos(candidatos)
    for c in candidatos:
        if c in achados:
            return achados[c]
    # 2) Lingua Libre: "LL-Q188 (deu)-<usuário>-<palavra>.wav"
    base = vs[0]
    busca = api({
        "action": "query", "list": "search", "srnamespace": 6, "srlimit": 50,
        "srsearch": f'intitle:"LL-Q188 (deu)" intitle:"{base}"',
    })
    padrao = re.compile(
        r"^File:LL-Q188 \(deu\)-.+?-(" + "|".join(re.escape(v) for v in vs) + r")\.(wav|ogg|flac)$"
    )
    titulos = sorted(r["title"] for r in busca.get("query", {}).get("search", []) if padrao.match(r["title"]))
    if titulos:
        achados = info_arquivos(titulos[:10])
        for t in titulos[:10]:
            if t in achados:
                return achados[t]
    return None


# ---------- Piper ----------

def carregar_piper():
    try:
        from piper import PiperVoice
    except ImportError:
        print("  ! Piper não instalado (pip install piper-tts). Pulando voz sintética.")
        return None, None
    CACHE_VOZ.mkdir(exist_ok=True)
    for voz in VOZES_PIPER:
        _, nome, qualidade = voz.split("-")
        modelo = CACHE_VOZ / f"{voz}.onnx"
        config = CACHE_VOZ / f"{voz}.onnx.json"
        try:
            for ext, destino in ((".onnx", modelo), (".onnx.json", config)):
                if not destino.exists():
                    print(f"  baixando voz {voz}{ext} …")
                    baixar(URL_VOZ.format(nome=nome, qualidade=qualidade, ext=ext), destino)
            return PiperVoice.load(str(modelo), config_path=str(config)), voz
        except Exception as e:  # tenta a próxima qualidade
            print(f"  ! não foi possível usar {voz}: {e}")
            modelo.unlink(missing_ok=True)
            config.unlink(missing_ok=True)
    return None, None


def sintetizar(voz, texto, destino_wav):
    cfg = None
    try:
        from piper import SynthesisConfig
        cfg = SynthesisConfig(length_scale=1.1)  # um pouco mais devagar, para estudo
    except Exception:
        pass
    with wave.open(str(destino_wav), "wb") as wf:
        voz.synthesize_wav(texto, wf, syn_config=cfg)


# ---------- principal ----------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sem-wikimedia", action="store_true")
    ap.add_argument("--sem-piper", action="store_true")
    ap.add_argument("--rebuscar", action="store_true")
    args = ap.parse_args()

    PASTA_AUDIO.mkdir(exist_ok=True)
    textos = textos_das_questoes()
    manifest = ler_manifest()

    def falta(k):
        e = manifest.get(k)
        if not e or not (RAIZ / e["arquivo"]).exists():
            return True
        return args.rebuscar and e.get("fonte") == "piper"

    pendentes = [(k, t) for k, t in sorted(textos.items()) if falta(k)]
    print(f"{len(textos)} palavras/frases nas questões; {len(pendentes)} para processar.")

    sem_gravacao = []
    for k, texto in pendentes:
        achou = None
        if not args.sem_wikimedia:
            try:
                achou = buscar_commons(texto)
            except Exception as e:
                print(f"  ! erro consultando o Commons para '{texto}': {e}")
        if achou:
            bruto = PASTA_AUDIO / ("_tmp_" + k + Path(urllib.parse.urlparse(achou["url"]).path).suffix)
            try:
                baixar(achou["url"], bruto)
                final = para_mp3(bruto, PASTA_AUDIO / f"{k}.mp3")
                manifest[k] = {
                    "texto": texto,
                    "arquivo": f"audio/{final.name}",
                    "fonte": "wikimedia",
                    "original": achou["titulo"],
                    "pagina": achou["pagina"],
                    "autor": achou["autor"],
                    "licenca": achou["licenca"],
                    "licencaUrl": achou["licencaUrl"],
                }
                print(f"  voz humana  : {texto}  ←  {achou['titulo']}")
                salvar_manifest(manifest)
                continue
            except Exception as e:
                print(f"  ! falha ao baixar '{achou['url']}': {e}")
                bruto.unlink(missing_ok=True)
        if not (manifest.get(k) and manifest[k].get("fonte") == "piper" and (RAIZ / manifest[k]["arquivo"]).exists()):
            sem_gravacao.append((k, texto))

    if sem_gravacao and not args.sem_piper:
        voz, nome_voz = carregar_piper()
        if voz:
            for k, texto in sem_gravacao:
                try:
                    wav = PASTA_AUDIO / f"_tmp_{k}.wav"
                    sintetizar(voz, texto, wav)
                    final = para_mp3(wav, PASTA_AUDIO / f"{k}.mp3", normalizar=False)
                    manifest[k] = {"texto": texto, "arquivo": f"audio/{final.name}", "fonte": "piper", "voz": nome_voz}
                    print(f"  voz sintética: {texto}")
                except Exception as e:
                    print(f"  ! Piper falhou em '{texto}': {e}")
            salvar_manifest(manifest)

    # remove do manifest o que não é mais usado por nenhuma questão
    for k in [k for k in manifest if k not in textos]:
        arq = RAIZ / manifest[k]["arquivo"]
        arq.unlink(missing_ok=True)
        del manifest[k]
    salvar_manifest(manifest)

    humanas = sum(1 for e in manifest.values() if e["fonte"] == "wikimedia")
    sinteticas = sum(1 for e in manifest.values() if e["fonte"] == "piper")
    print(f"Pronto: {humanas} gravações humanas, {sinteticas} vozes sintéticas, "
          f"{len(textos) - humanas - sinteticas} sem áudio (usarão a voz do navegador).")


if __name__ == "__main__":
    sys.exit(main())
