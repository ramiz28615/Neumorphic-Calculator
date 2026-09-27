import { InferenceClient } from "https://esm.sh/@huggingface/inference@4";

const $ = (s) => document.querySelector(s);
const MODEL_DEFAULT = "ramiz282828/NSFW_Wan_1.3b-bucket";
let selectedFile = null;
let busy = false;

const state = {
  token: sessionStorage.getItem("hf_token") || "",
  model: localStorage.getItem("hf_model") || MODEL_DEFAULT,
  endpoint: localStorage.getItem("hf_endpoint") || "",
  provider: localStorage.getItem("hf_provider") || "auto",
  pipeline: "text-to-video",
  providers: [],
};

function escapeHTML(s=""){return s.replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"}[c]));}
function shortModel(){return state.model.split("/").pop() || state.model;}
function scrollBottom(){requestAnimationFrame(()=>{$("#content").scrollTop=$("#content").scrollHeight;});}
function toast(msg){const el=document.createElement("div");el.textContent=msg;Object.assign(el.style,{position:"fixed",left:"50%",bottom:"24px",transform:"translateX(-50%)",background:"#242431",color:"#fff",padding:"10px 14px",borderRadius:"10px",zIndex:99,fontSize:"13px",boxShadow:"0 10px 30px #0008"});document.body.appendChild(el);setTimeout(()=>el.remove(),2600);}

function addMessage(role, html){
  $("#hero").classList.add("hidden");
  const row=document.createElement("div");row.className=`message ${role}`;
  row.innerHTML=`<div class="avatar">${role==="user"?"U":"✦"}</div><div class="bubble">${html}</div>`;
  $("#messages").appendChild(row);scrollBottom();return row.querySelector(".bubble");
}

function addHistory(prompt){
  const arr=JSON.parse(localStorage.getItem("wan_history")||"[]");arr.unshift({prompt,at:Date.now()});localStorage.setItem("wan_history",JSON.stringify(arr.slice(0,12)));renderHistory();
}
function renderHistory(){const arr=JSON.parse(localStorage.getItem("wan_history")||"[]");$("#history").innerHTML=arr.map((x,i)=>`<div class="history-item" data-i="${i}" title="${escapeHTML(x.prompt)}">${escapeHTML(x.prompt)}</div>`).join("");document.querySelectorAll(".history-item").forEach(el=>el.onclick=()=>{$("#prompt").value=arr[+el.dataset.i].prompt;autoResize();});}

function syncUI(){
  $("#modelShort").textContent=shortModel();$("#modelInput").value=state.model;$("#endpointInput").value=state.endpoint;$("#providerInput").value=state.provider;$("#tokenInput").value=state.token;
  const imageMode=!!selectedFile;$("#modeBadge").textContent=imageMode?"Image + Text → Video":"Text → Video";
}

async function checkModel(showResult=true){
  $("#modelStatus").textContent="Kontrol ediliyor…";$("#statusDot").className="dot";
  if(showResult) $("#checkResult").innerHTML="Model bilgisi alınıyor…";
  try{
    const modelUrl = "https://huggingface.co/api/models/" + state.model;
    const basicRes = await fetch(modelUrl);
    if(!basicRes.ok) throw new Error(`Hub API ${basicRes.status}`);
    const basic = await basicRes.json();

    state.pipeline = basic.pipeline_tag || basic.tags?.find(t=>[
      "text-to-video","image-to-video","text-to-image","image-to-image"
    ].includes(t)) || "bilinmiyor";

    let mapping = {};
    try{
      const providerRes = await fetch(modelUrl + "?expand=inferenceProviderMapping");
      if(providerRes.ok){
        const providerInfo = await providerRes.json();
        mapping = providerInfo.inferenceProviderMapping || {};
      }
    }catch(_){}

    state.providers = Object.entries(mapping)
      .filter(([,v])=>!v || v.status==="live" || v.status==="staging")
      .map(([k])=>k);

    const live = state.providers.length>0 || !!state.endpoint;
    $("#pipelineLabel").textContent = `${state.pipeline} · ${state.providers.length?state.providers.join(", "):"provider bulunamadı"}`;
    $("#modelStatus").textContent = live ? "API bağlantısı kullanılabilir" : "Model bulundu · serverless provider yok";
    $("#statusDot").className = `dot ${live?"good":"bad"}`;

    if(showResult){
      $("#checkResult").innerHTML =
        `<b>Model:</b> ${escapeHTML(state.model)}<br>`+
        `<b>Pipeline:</b> ${escapeHTML(state.pipeline)}<br>`+
        `<b>Inference provider:</b> ${state.providers.length?escapeHTML(state.providers.join(", ")):"Yok"}`+
        (state.endpoint?"<br><b>Özel endpoint:</b> ayarlı":"")+
        (!state.providers.length && !state.endpoint
          ? "<br><br><b>Not:</b> Model Hub üzerinde mevcut, fakat Hugging Face serverless Inference Provider tarafından sunulmuyor. Üretim için özel Inference Endpoint gerekir."
          : "");
    }
    return basic;
  }catch(e){
    $("#pipelineLabel").textContent="Model kontrolü başarısız";
    $("#modelStatus").textContent="Model/API bulunamadı";
    $("#statusDot").className="dot bad";
    if(showResult) $("#checkResult").textContent=`Hata: ${e.message}`;
    return null;
  }
}
async function generate(){
  const prompt=$("#prompt").value.trim();if(!prompt||busy)return;
  if(!state.token){$("#settingsModal").classList.remove("hidden");toast("Önce Hugging Face token'ını gir.");return;}
  busy=true;$("#generateBtn").disabled=true;
  addMessage("user",`${escapeHTML(prompt)}${selectedFile?`<div style="color:#999;font-size:12px;margin-top:7px">📎 ${escapeHTML(selectedFile.name)}</div>`:""}`);
  addHistory(prompt);
  const bubble=addMessage("assistant",`<span class="loader"></span> Video oluşturuluyor…`);
  try{
    const client = state.endpoint
      ? new InferenceClient(state.token,{endpointUrl:state.endpoint.replace(/\/$/,"")})
      : new InferenceClient(state.token);
    const common={model:state.endpoint?undefined:state.model,inputs:prompt,provider:state.endpoint?undefined:state.provider};
    let out;
    if(selectedFile){
      out=await client.imageTextToVideo({...common,image:selectedFile});
    }else{
      out=await client.textToVideo(common);
    }
    const blob=out instanceof Blob?out:(out?.video instanceof Blob?out.video:new Blob([out],{type:"video/mp4"}));
    const url=URL.createObjectURL(blob);
    bubble.innerHTML=`<b>Video hazır.</b><video class="result-video" src="${url}" controls playsinline></video><div class="result-actions"><a href="${url}" download="wan-${Date.now()}.mp4">⬇ Videoyu indir</a></div>`;
    $("#prompt").value="";autoResize();clearFile();
  }catch(e){
    const raw=e?.message||String(e);
    bubble.innerHTML=`<b>Üretim başarısız.</b><br><span style="color:#aaa">${escapeHTML(raw)}</span><br><br><small>Bu hata çoğunlukla modelin Inference Provider üzerinde yayınlanmaması, provider'ın modeli desteklememesi veya token izninin eksik olması nedeniyle olur. Model için özel Hugging Face Inference Endpoint açtıysan Ayarlar bölümüne URL'sini gir.</small>`;
  }finally{busy=false;$("#generateBtn").disabled=false;scrollBottom();}
}

function autoResize(){const t=$("#prompt");t.style.height="auto";t.style.height=Math.min(t.scrollHeight,180)+"px";}
function clearFile(){selectedFile=null;$("#fileInput").value="";$("#filePreview").classList.add("hidden");$("#filePreview").innerHTML="";syncUI();}

$("#fileInput").addEventListener("change",e=>{selectedFile=e.target.files?.[0]||null;if(!selectedFile)return;const url=URL.createObjectURL(selectedFile);$("#filePreview").innerHTML=`<img src="${url}"><span>${escapeHTML(selectedFile.name)}</span><button id="removeFile">✕</button>`;$("#filePreview").classList.remove("hidden");$("#removeFile").onclick=clearFile;syncUI();});
$("#prompt").addEventListener("input",autoResize);$("#prompt").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();generate();}});$("#generateBtn").onclick=generate;
$("#settingsBtn").onclick=()=>$("#settingsModal").classList.remove("hidden");$("#closeSettings").onclick=()=>$("#settingsModal").classList.add("hidden");
$("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
$("#newChat").onclick=()=>{$("#messages").innerHTML="";$("#hero").classList.remove("hidden");$("#prompt").value="";clearFile();};
document.querySelectorAll(".chips button").forEach(b=>b.onclick=()=>{$("#prompt").value=b.dataset.prompt;autoResize();$("#prompt").focus();});
$("#saveSettings").onclick=async()=>{state.token=$("#tokenInput").value.trim();state.model=$("#modelInput").value.trim()||MODEL_DEFAULT;state.endpoint=$("#endpointInput").value.trim();state.provider=$("#providerInput").value;sessionStorage.setItem("hf_token",state.token);localStorage.setItem("hf_model",state.model);localStorage.setItem("hf_endpoint",state.endpoint);localStorage.setItem("hf_provider",state.provider);syncUI();await checkModel(true);$("#settingsModal").classList.add("hidden");toast("Ayarlar kaydedildi.");};
$("#checkBtn").onclick=async()=>{state.model=$("#modelInput").value.trim()||MODEL_DEFAULT;state.endpoint=$("#endpointInput").value.trim();state.provider=$("#providerInput").value;syncUI();await checkModel(true);};
$("#settingsModal").addEventListener("click",e=>{if(e.target===$("#settingsModal"))$("#settingsModal").classList.add("hidden");});

renderHistory();syncUI();checkModel(false);
if(!state.token)setTimeout(()=>$("#settingsModal").classList.remove("hidden"),350);