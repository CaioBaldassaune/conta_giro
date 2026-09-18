"""Valida um XML contra um esquema XSD (usado pelos testes da NFS-e).
Uso: python scripts/validar-xsd.py <esquema.xsd> <arquivo.xml>

Observação sobre os esquemas oficiais da NFS-e Nacional (v1.01): alguns padrões usam
"^" e "$" (ex.: TSSerieDPS = '^0{0,4}\\d{1,5}$'). Em regex de XSD esses símbolos são
literais — as âncoras já são implícitas —, então a leitura estrita recusaria qualquer
série. O validador da Sefin os trata como âncoras; para reproduzir esse comportamento,
validamos contra uma cópia temporária dos esquemas sem "^" inicial e "$" final nos
padrões. Os arquivos oficiais em docs/nfse/esquemas ficam intactos.
"""
import re
import shutil
import sys
import tempfile
from pathlib import Path

from lxml import etree

origem = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory() as pasta:
    copia = Path(pasta)
    for arquivo in origem.parent.glob("*.xsd"):
        texto = arquivo.read_text(encoding="utf-8")
        texto = re.sub(r'(<xs:pattern value=")\^(.*?)\$(")', r"\1\2\3", texto)
        (copia / arquivo.name).write_text(texto, encoding="utf-8")
    esquema = etree.XMLSchema(etree.parse(str(copia / origem.name)))
    documento = etree.parse(sys.argv[2])
    if esquema.validate(documento):
        print("OK")
        sys.exit(0)
    for erro in esquema.error_log:
        print(f"linha {erro.line}: {erro.message}")
    sys.exit(1)
