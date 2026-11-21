
// Shared Innertube logic — ported from the original server actions.
// Includes the 2026-11-22 anti bot-check fix: 9 client versions, merged
// formats, 10-minute cache, and 3 passes with escalating pauses.
// Public Innertube client key (same key YouTube's own web client uses,
// embedded in youtube.com pages). Override with YT_INNERTUBE_KEY env if needed.
const INNERTUBE_KEY = process.env.YT_INNERTUBE_KEY || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const VR_UA = "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1)";
const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const MAX_FILE_BYTES = 256 * 1024 * 1024;
function parseVideoId(input){
  const text=(input||"").trim();
  if(/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const pats=[/[?&]v=([A-Za-z0-9_-]{11})/,/youtu\.be\/([A-Za-z0-9_-]{11})/,/\/shorts\/([A-Za-z0-9_-]{11})/,/\/live\/([A-Za-z0-9_-]{11})/,/\/embed\/([A-Za-z0-9_-]{11})/,/\/v\/([A-Za-z0-9_-]{11})/];
  for(const re of pats){const m=text.match(re); if(m&&m[1]) return m[1];}
  return null;
}
function looksLikeUrl(t){return /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test((t||"").trim());}
// Anti bot-check chain (updated 2026-11-22): YouTube judges every client
// VERSION independently, so the chain carries several versions of the
// same families as independent chances — ANDROID_VR 1.65.10 / 1.60.19 /
// 1.50.23, ANDROID 20.10.38 / 20.30.36 / 20.14.38, IOS 20.10.4 / 20.14.38,
// plus VISIONOS. Only 20.x+ ANDROID/IOS versions are used (older ones
// are rejected by YouTube with HTTP 400).
const PLAYER_CLIENTS=[
 {ua:VR_UA,client:{clientName:"ANDROID_VR",clientVersion:"1.65.10",deviceModel:"Oculus Quest 3",androidSdkVersion:32,hl:"en"}},
 {ua:"com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1)",client:{clientName:"ANDROID_VR",clientVersion:"1.60.19",deviceModel:"Oculus Quest 3",androidSdkVersion:32,hl:"en"}},
 {ua:"com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",client:{clientName:"ANDROID",clientVersion:"20.10.38",androidSdkVersion:30,osName:"Android",osVersion:"11",hl:"en",gl:"US"}},
 {ua:"com.google.android.youtube/20.30.36 (Linux; U; Android 11) gzip",client:{clientName:"ANDROID",clientVersion:"20.30.36",androidSdkVersion:30,osName:"Android",osVersion:"11",hl:"en",gl:"US"}},
 {ua:"com.google.android.youtube/20.14.38 (Linux; U; Android 11) gzip",client:{clientName:"ANDROID",clientVersion:"20.14.38",androidSdkVersion:30,osName:"Android",osVersion:"11",hl:"en",gl:"US"}},
 {ua:"com.google.android.apps.youtube.vr.oculus/1.50.23 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1)",client:{clientName:"ANDROID_VR",clientVersion:"1.50.23",deviceModel:"Oculus Quest 3",androidSdkVersion:32,hl:"en"}},
 {ua:"com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",client:{clientName:"IOS",clientVersion:"20.10.4",deviceMake:"Apple",deviceModel:"iPhone16,2",osName:"iOS",osVersion:"18.3.2.22D82",hl:"en",gl:"US"}},
 {ua:"com.google.ios.youtube/20.14.38 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",client:{clientName:"IOS",clientVersion:"20.14.38",deviceMake:"Apple",deviceModel:"iPhone16,2",osName:"iOS",osVersion:"18.3.2.22D82",hl:"en",gl:"US"}},
 {ua:"com.google.ios.youtube/20.10.4 (RealityFamily12,2; U; CPU visionOS 2_3 like Mac OS X;)",client:{clientName:"VISIONOS",clientVersion:"1.02",deviceMake:"Apple",deviceModel:"RealityFamily12,2",osName:"visionOS",osVersion:"2.3.23M1003",hl:"en",gl:"US"}},
];
async function fetchPlayerOnce(spec,videoId){
  let res;
  try{res=await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`,{method:"POST",headers:{"Content-Type":"application/json","User-Agent":spec.ua},body:JSON.stringify({context:{client:spec.client},videoId,racyCheckOk:true,contentCheckOk:true})});}catch{return{ok:false,kind:"other",reason:""};}
  if(!res.ok) return{ok:false,kind:"other",reason:""};
  const j=await res.json();
  const status=j.playabilityStatus?.status, reason=j.playabilityStatus?.reason||"";
  const formats=j.streamingData?.formats||[], adaptiveFormats=j.streamingData?.adaptiveFormats||[];
  if(status==="OK"&&[...formats,...adaptiveFormats].some(f=>f.url)) return{ok:true,data:{title:j.videoDetails?.title||"",author:j.videoDetails?.author||"",durationSeconds:Number(j.videoDetails?.lengthSeconds||0)||0,formats,adaptiveFormats}};
  if(/private/i.test(reason)) return{ok:false,kind:"private",reason};
  if(/live stream|live/i.test(reason)) return{ok:false,kind:"live",reason};
  if(/age/i.test(reason)) return{ok:false,kind:"age",reason};
  if(status==="LOGIN_REQUIRED"||/sign in|login|not a bot/i.test(reason)) return{ok:false,kind:"bot",reason};
  return{ok:false,kind:"other",reason};
}
const cache=new Map(); const TTL=10*60*1000;
function hasMuxed(d){return d.formats.some(f=>f.url&&(f.mimeType||"").startsWith("video/mp4"));}
function hasAudio(d){return d.adaptiveFormats.some(f=>f.url&&(f.mimeType||"").startsWith("audio/"));}
function merge(base,next){if(!base) return next; const sf=new Set(base.formats.map(f=>`${f.itag}|${f.mimeType||""}`)); const formats=[...base.formats]; for(const f of next.formats){const k=`${f.itag}|${f.mimeType||""}`; if(!sf.has(k)){sf.add(k);formats.push(f);}} const sa=new Set(base.adaptiveFormats.map(f=>`${f.itag}|${f.audioTrack?.displayName||""}`)); const adaptiveFormats=[...base.adaptiveFormats]; for(const f of next.adaptiveFormats){const k=`${f.itag}|${f.audioTrack?.displayName||""}`; if(!sa.has(k)){sa.add(k);adaptiveFormats.push(f);}} return{title:base.title||next.title,author:base.author||next.author,durationSeconds:base.durationSeconds||next.durationSeconds,formats,adaptiveFormats};}
async function fetchPlayer(videoId,opts){
  if(!opts?.skipCache){const c=cache.get(videoId); if(c&&Date.now()-c.at<TTL) return c.data;}
  let otherReason="", merged=null;
  // Three passes with escalating pauses (1500ms, 4000ms): the bot check
  // is intermittent per client/IP, so re-walking the 9-client chain
  // rescues videos refused on the first attempt.
  const PASS_PAUSES_MS=[1500,4000];
  for(let pass=0;pass<3;pass++){
    let sawBot=false;
    for(const spec of PLAYER_CLIENTS){
      const r=await fetchPlayerOnce(spec,videoId);
      if(r.ok){merged=merge(merged,r.data); if(hasMuxed(merged)&&hasAudio(merged)){cache.set(videoId,{data:merged,at:Date.now()}); return merged;} continue;}
      if(r.kind==="bot"){sawBot=true; continue;}
      if(!merged){
        if(r.kind==="private") throw new Error("Video ini privat dan tidak bisa dikonversi.");
        if(r.kind==="live") throw new Error("Siaran langsung tidak bisa dikonversi.");
        if(r.kind==="age") throw new Error("Video ini dibatasi usia oleh YouTube, jadi belum bisa dikonversi. Coba video lain ya.");
      }
      if(r.reason) otherReason=r.reason;
    }
    if(merged&&hasMuxed(merged)&&hasAudio(merged)) break;
    if(!merged&&!sawBot) break;
    const pause=PASS_PAUSES_MS[pass];
    if(pause) await new Promise(r=>setTimeout(r,pause));
  }
  if(merged){cache.set(videoId,{data:merged,at:Date.now()}); return merged;}
  if(/unavailable|not available/i.test(otherReason)) throw new Error("Video ini tidak tersedia di YouTube (mungkin sudah dihapus atau dibatasi). Coba video lain ya.");
  if(otherReason) throw new Error(`Video tidak bisa diputar: ${otherReason}`);
  throw new Error("YouTube sedang membatasi akses ke video ini (cek bot / perlu login), jadi belum bisa dikonversi. Coba lagi sebentar, atau coba video lain ya.");
}
async function fetchOembed(videoId){try{const res=await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`); if(!res.ok) return null; const j=await res.json(); return{title:j.title||"",author:j.author_name||""};}catch{return null;}}
function audioTracksOf(p){const seen=new Map(); for(const f of p.adaptiveFormats){const n=f.audioTrack?.displayName; if(n&&!seen.has(n)) seen.set(n,n);} return[...seen.entries()].map(([id,label])=>({id,label}));}
function pickAudio(p,track){let a=p.adaptiveFormats.filter(f=>f.url&&(f.mimeType||"").startsWith("audio/")); if(track&&track!=="Asli"){const d=a.filter(f=>f.audioTrack?.displayName===track); if(d.length) a=d;} if(!a.length) return null; const mp4=a.filter(f=>(f.mimeType||"").startsWith("audio/mp4")).sort((x,y)=>(y.bitrate||0)-(x.bitrate||0)); if(mp4[0]) return mp4[0]; return a.sort((x,y)=>(y.bitrate||0)-(x.bitrate||0))[0]||null;}
function pickMuxed(p){const m=p.formats.filter(f=>f.url&&(f.mimeType||"").startsWith("video/mp4")); if(!m.length) return null; return m.sort((a,b)=>parseInt(b.qualityLabel||"0",10)-parseInt(a.qualityLabel||"0",10))[0]||null;}
function extAndLabel(fmt,mode){const mime=fmt.mimeType||"",kbps=Math.round((fmt.bitrate||0)/1000); if(mode==="mp3"){if(mime.startsWith("audio/mp4")) return{ext:"m4a",container:"M4A",label:`Audio ${kbps} kbps`}; if(mime.startsWith("audio/webm")) return{ext:"webm",container:"WebM",label:`Audio ${kbps} kbps`}; return{ext:"mp3",container:"MP3",label:`Audio ${kbps} kbps`};} return{ext:"mp4",container:"MP4",label:fmt.qualityLabel?`Video ${fmt.qualityLabel}`:"Video MP4"};}
function safeFilename(title,ext){const c=(title||"").replace(/[\\/:*?"<>|]/g,"").replace(/\s+/g," ").trim().slice(0,80); return `${c||"video"}.${ext}`;}
async function buildInfo(videoId){const[player,oembed]=await Promise.all([fetchPlayer(videoId),fetchOembed(videoId)]); const audio=pickAudio(player,"Asli"), muxed=pickMuxed(player); return{player,info:{videoId,title:oembed?.title||player.title||videoId,author:oembed?.author||player.author||"",durationSeconds:player.durationSeconds,thumbnailUrl:`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,hasMp4:!!muxed,mp4Label:muxed?.qualityLabel?`MP4 ${muxed.qualityLabel}`:"",audioLabel:audio?`Audio ${Math.round((audio.bitrate||0)/1000)} kbps`:"",audioTracks:audioTracksOf(player)}};}
function cors(res){res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS"); res.setHeader("Access-Control-Allow-Headers","Content-Type");}
async function readBody(req){if(req.body) return req.body; return new Promise((resolve)=>{let d=""; req.on("data",c=>d+=c); req.on("end",()=>{try{resolve(JSON.parse(d||"{}"))}catch{resolve({})}});});}
module.exports={parseVideoId,looksLikeUrl,fetchPlayer,buildInfo,pickAudio,pickMuxed,extAndLabel,safeFilename,INNERTUBE_KEY,WEB_UA,MAX_FILE_BYTES,cors,readBody};
