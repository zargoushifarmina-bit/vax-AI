
import express from "express";
const app=express();
const PORT=process.env.PORT||3000;
app.use(express.json({limit:"2mb"}));
app.use(express.static("public"));

async function getJSON(url, opts={}){
  const r=await fetch(url,{headers:{"User-Agent":"VaxAI-Pro/2.0 research prototype","Accept":"application/json",...(opts.headers||{})},...opts});
  const text=await r.text();
  let data; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return data;
}

/* IEDB IQ-API: PostgREST query proxy */
app.get("/api/iedb/:table", async(req,res)=>{
  const allowed=["epitope_search","tcell_search","bcell_search","mhc_search","antigen_search","reference_search"];
  const table=req.params.table;
  if(!allowed.includes(table)) return res.status(400).json({error:"unsupported IEDB table"});
  try{
    const qs=new URLSearchParams(req.query);
    if(!qs.has("limit")) qs.set("limit","25");
    const data=await getJSON(`https://query-api.iedb.org/${table}?${qs}`);
    res.json({source:"IEDB",table,data});
  }catch(e){res.status(502).json({error:e.message,source:"IEDB"});}
});

/* UniProt */
app.get("/api/uniprot/search", async(req,res)=>{
  const q=(req.query.q||"").trim();
  if(!q) return res.status(400).json({error:"q is required"});
  try{
    const url="https://rest.uniprot.org/uniprotkb/search?"+new URLSearchParams({
      query:q,format:"json",size:String(Math.min(Number(req.query.size)||10,50)),
      fields:"accession,id,protein_name,organism_name,length,sequence"
    });
    const data=await getJSON(url);
    res.json({source:"UniProt",...data});
  }catch(e){res.status(502).json({error:e.message,source:"UniProt"});}
});

/* NCBI Protein/PubMed search */
app.get("/api/ncbi/search", async(req,res)=>{
  const db=req.query.db||"protein", term=(req.query.term||"").trim();
  if(!term) return res.status(400).json({error:"term is required"});
  if(!["protein","pubmed"].includes(db)) return res.status(400).json({error:"db must be protein or pubmed"});
  try{
    const base="https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
    const s=await getJSON(base+"esearch.fcgi?"+new URLSearchParams({
      db,term,retmode:"json",retmax:String(Math.min(Number(req.query.retmax)||10,50))
    }));
    const ids=s?.esearchresult?.idlist||[];
    let summaries=[];
    if(ids.length){
      const u=base+"esummary.fcgi?"+new URLSearchParams({db,id:ids.join(","),retmode:"json"});
      const sm=await getJSON(u); summaries=ids.map(id=>sm.result?.[id]).filter(Boolean);
    }
    res.json({source:"NCBI",db,ids,summaries});
  }catch(e){res.status(502).json({error:e.message,source:"NCBI"});}
});

/* Unified known-pathogen evidence workflow */
app.get("/api/optimize", async(req,res)=>{
  const pathogen=(req.query.pathogen||"").trim();
  if(!pathogen) return res.status(400).json({error:"pathogen is required"});
  try{
    const [uni,iedb,pub]=await Promise.allSettled([
      getJSON("https://rest.uniprot.org/uniprotkb/search?"+new URLSearchParams({
        query:`(${pathogen})`,format:"json",size:"8",
        fields:"accession,id,protein_name,organism_name,length"
      })),
      getJSON("https://query-api.iedb.org/epitope_search?limit=25"),
      getJSON("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?"+new URLSearchParams({
        db:"pubmed",term:`${pathogen} epitope vaccine`,retmode:"json",retmax:"10"
      }))
    ]);
    res.json({pathogen,
      sources:{
        uniprot:uni.status==="fulfilled"?uni.value:{error:uni.reason?.message},
        iedb:iedb.status==="fulfilled"?iedb.value:{error:iedb.reason?.message},
        pubmed:pub.status==="fulfilled"?pub.value:{error:pub.reason?.message}
      },
      note:"Evidence aggregation prototype. Ranking is transparent and does not claim clinical efficacy."
    });
  }catch(e){res.status(500).json({error:e.message});}
});

/* DISCOVER: collect researcher metadata and retrieve related public records.
   Similarity is intentionally reported as research leads, not as a confirmed pathogen identity. */
app.post("/api/discover", async(req,res)=>{
  const {name="",family="",host="",sequence="",phenotype=""}=req.body||{};
  if(!name&&!family&&!sequence&&!phenotype) return res.status(400).json({error:"enter at least one research feature"});
  const query=[name,family,host,phenotype].filter(Boolean).join(" ");
  try{
    const [u,n]=await Promise.allSettled([
      query?getJSON("https://rest.uniprot.org/uniprotkb/search?"+new URLSearchParams({
        query,format:"json",size:"12",fields:"accession,id,protein_name,organism_name,length"
      })):Promise.resolve(null),
      query?getJSON("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?"+new URLSearchParams({
        db:"protein",term:query,retmode:"json",retmax:"12"
      })):Promise.resolve(null)
    ]);
    res.json({
      input:{name,family,host,phenotype,sequenceLength:sequence.replace(/[^A-Za-z]/g,"").length},
      nearestResearchLeads:{
        uniprot:u.status==="fulfilled"?u.value:{error:u.reason?.message},
        ncbi:n.status==="fulfilled"?n.value:{error:n.reason?.message}
      },
      interpretation:"Similarity leads require independent sequence/phylogenetic validation before biological identification.",
      nextEvidence:"Use the identified taxa/antigens as search terms against IEDB and PubMed."
    });
  }catch(e){res.status(500).json({error:e.message});}
});

/* DESIGN: multi-pathogen evidence matrix only; no operational construct generation. */
app.post("/api/design", async(req,res)=>{
  const pathogens=Array.isArray(req.body?.pathogens)?req.body.pathogens.filter(Boolean).slice(0,6):[];
  if(pathogens.length<2) return res.status(400).json({error:"select at least two pathogens"});
  const rows=[];
  for(const p of pathogens){
    try{
      const r=await getJSON("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?"+new URLSearchParams({
        db:"pubmed",term:`${p} epitope`,retmode:"json",retmax:"5"
      }));
      rows.push({pathogen:p,pubmedEvidenceCount:Number(r.esearchresult?.count||0),examplePMIDs:r.esearchresult?.idlist||[]});
    }catch(e){rows.push({pathogen:p,error:e.message})}
  }
  res.json({
    pathogens,rows,
    sharedCriteria:["experimental evidence","conservation across strains","MHC/T-cell evidence","B-cell/antibody evidence","structural feasibility"],
    note:"DESIGN produces a comparative research specification and evidence matrix. It does not output an operational vaccine sequence or wet-lab protocol."
  });
});

app.get("/api/health",(req,res)=>res.json({ok:true,service:"VaxAI Pro",version:"2.0.0"}));
app.get("*",(req,res)=>res.sendFile("index.html",{root:"public"}));
app.listen(PORT,()=>console.log(`VaxAI Pro running on http://localhost:${PORT}`));
