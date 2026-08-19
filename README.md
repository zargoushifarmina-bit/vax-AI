# VaxAI Pro — Final MVP v2

این نسخه دقیقاً چهار بخش دارد:
1) نمای اصلی
2) OPTIMIZE
3) DISCOVER
4) DESIGN

## اجرا
Node.js 18+:
npm install
npm start

سپس http://localhost:3000

## APIهای زنده
- IEDB IQ-API: https://query-api.iedb.org/
- UniProt REST: https://rest.uniprot.org/
- NCBI E-utilities: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/

## معماری
OPTIMIZE -> UniProt + IEDB + PubMed
DISCOVER -> researcher features + UniProt/NCBI research leads
DESIGN -> multi-pathogen evidence matrix + PubMed evidence

RCSB PDB در معماری منبع ساختاری در نظر گرفته شده و در گام production باید با jobهای ساختاری/structure retrieval متصل شود.

این MVP خروجی تصمیم‌یار و evidence aggregation می‌دهد؛ ادعای efficacy بالینی، پروتکل Wet Lab یا توالی عملیاتی سازه واکسن را تولید نمی‌کند.
