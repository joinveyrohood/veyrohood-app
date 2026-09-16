const SUPABASE_URL="https://zrrhxvrswvqlsbjjgool.supabase.co";
const SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpycmh4dnJzd3ZxbHNiampnb29sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NDIxNDgsImV4cCI6MjEwNTAxODE0OH0.kTttSr6ACdLmiL9CzyF1chHkc_BGBOzlsERffdzzUuQ";
const TREASURY="0xf6F80827cBAf83798c7763FCd915C0068F2bE60C";
const CONTRACT_ADDRESS="";
const CHAIN_ID=4663,CHAIN_HEX="0x1237",FEE_USD=0.25,REF_USD=0.05,WD_MIN=2,OG_CAP=1000;
const SITE=location.origin+location.pathname.replace(/index\.html$/,"");
const STEPS=["connect","follow","discord","quote","reply","ids","pay"];
const POOL_ABI=["function verify(address referrer) payable","function withdraw()"];
const db=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
let userWallet=null,provider=null,stepIndex=0;
const done={follow:false,discord:false,quote:false,reply:false};
const $=id=>document.getElementById(id);
function showMsg(el,type,text){el.className="msg "+(type==="ok"?"ok":"err");el.textContent=text}
function shortAddr(a){return a.slice(0,6)+"..."+a.slice(-4)}
function xLinkOk(v){return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i.test((v||"").trim())}
function refFromUrl(){const r=(new URLSearchParams(location.search).get("ref")||"").trim().toLowerCase();return /^0x[a-f0-9]{40}$/.test(r)?r:""}
function renderRail(){$("rail").innerHTML=STEPS.map((_,i)=>"<i class='"+(i<=stepIndex?"on":"")+"'></i>").join("")}
function showStep(name){stepIndex=Math.max(stepIndex,STEPS.indexOf(name));STEPS.forEach((key,i)=>{const el=$("step-"+key);if(!el)return;if(i<=stepIndex)el.classList.add("show");if(i<stepIndex)el.classList.add("done-card")});renderRail()}
function markOpen(key,el,next){done[key]=true;el.className="btn okbtn";setTimeout(()=>showStep(next),400)}
$("t-follow").onclick=function(){markOpen("follow",this,"discord")};
$("t-discord").onclick=function(){markOpen("discord",this,"quote")};
$("t-quote").onclick=function(){this.className="btn okbtn";this.textContent="OPENED"};
$("t-reply").onclick=function(){this.className="btn okbtn";this.textContent="OPENED"};
$("quote-next").onclick=function(){if(!xLinkOk($("quote_link").value))return alert("Paste a valid X quote link.");done.quote=true;showStep("reply")};
$("reply-next").onclick=function(){if(!xLinkOk($("reply_link").value))return alert("Paste a valid X reply link.");done.reply=true;showStep("ids")};
$("ids-next").onclick=function(){if(!$("x_username").value.trim()||!$("discord_username").value.trim())return alert("Enter both usernames.");showStep("pay")};
async function switchChain(){
  try{await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:CHAIN_HEX}]})}
  catch(e){
    if(e.code===4902){
      await window.ethereum.request({method:"wallet_addEthereumChain",params:[{chainId:CHAIN_HEX,chainName:"Robinhood Chain",nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18},rpcUrls:["https://rpc.mainnet.chain.robinhood.com"],blockExplorerUrls:["https://robinhoodchain.blockscout.com"]}]});
    } else throw e;
  }
}
$("connect-btn").onclick=async function(){
  try{
    if(!window.ethereum)return alert("Install an EVM wallet.");
    provider=new ethers.BrowserProvider(window.ethereum);
    await switchChain();
    const accs=await provider.send("eth_requestAccounts",[]);
    userWallet=ethers.getAddress(accs[0]);
    $("wallet-line").textContent="Connected: "+userWallet;
    this.textContent="WALLET CONNECTED";
    this.className="okbtn";
    showStep("follow");
    await loadMine();
  }catch(e){alert(e.message||"Connect failed")}
};
async function feeWei(){
  const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
  const px=Number((await r.json()).ethereum.usd);
  return ethers.parseEther((FEE_USD/px).toFixed(8));
}
async function saveUser(row){
  const ex=await db.from("users").select("id").ilike("wallet_address",row.wallet_address).maybeSingle();
  if(ex.data){const {error}=await db.from("users").update(row).ilike("wallet_address",row.wallet_address);if(error)throw error}
  else{const {error}=await db.from("users").insert(row);if(error)throw error}
}
$("pay-btn").onclick=async function(){
  if(!userWallet)return showMsg($("pay-msg"),"err","Connect first.");
  if(!done.follow||!done.discord||!xLinkOk($("quote_link").value)||!xLinkOk($("reply_link").value))return showMsg($("pay-msg"),"err","Finish missions.");
  if(!$("x_username").value.trim()||!$("discord_username").value.trim())return showMsg($("pay-msg"),"err","Enter usernames.");
  this.disabled=true;
  try{
    const existing=await db.from("users").select("verification_status").ilike("wallet_address",userWallet).maybeSingle();
    if(existing.data&&existing.data.verification_status==="verified"){afterApprove(userWallet);showMsg($("pay-msg"),"ok","Already verified.");return}
    await switchChain();
    const signer=await provider.getSigner();
    const net=await provider.getNetwork();
    if(Number(net.chainId)!==CHAIN_ID)throw new Error("Switch to Robinhood Chain.");
    const value=await feeWei();
    const referrer=refFromUrl()&&refFromUrl()!==userWallet.toLowerCase()?refFromUrl():null;
    let rec;
    if(CONTRACT_ADDRESS){
      const pool=new ethers.Contract(CONTRACT_ADDRESS,POOL_ABI,signer);
      rec=await (await pool.verify(referrer||ethers.ZeroAddress,{value})).wait();
    }else{
      rec=await (await signer.sendTransaction({to:TREASURY,value})).wait();
    }
    if(!rec||rec.status!==1)throw new Error("Tx failed");
    let ogNow=0;
    try{const ogQ=await db.from("users").select("*",{count:"exact",head:true}).eq("verification_status","verified").eq("is_og",true);ogNow=ogQ.count||0}catch(_){}
    const isOg=ogNow<OG_CAP;
    await saveUser({wallet_address:userWallet.toLowerCase(),x_username:$("x_username").value.trim().replace(/^@+/,""),discord_username:$("discord_username").value.trim(),referrer_wallet:referrer,verification_status:"verified",is_og:isOg,payment_tx_hash:rec.hash,og_assigned_at:isOg?new Date().toISOString():null});
    await db.from("verifications").insert({wallet_address:userWallet.toLowerCase(),x_follow:true,discord_join:true,quote_link:$("quote_link").value.trim(),reply_link:$("reply_link").value.trim(),is_verified:true,verified_at:new Date().toISOString(),tx_hash:rec.hash,payment_amount_usd:FEE_USD});
    if(referrer){
      await db.from("referrals").insert({referrer_wallet:referrer,referred_wallet:userWallet.toLowerCase(),payment_amount:FEE_USD,referrer_amount:REF_USD,tx_hash:rec.hash,status:"paid"});
      const {count}=await db.from("referrals").select("*",{count:"exact",head:true}).eq("referrer_wallet",referrer).eq("status","paid");
      await db.from("users").update({referral_count:count||0,referral_earnings:((count||0)*REF_USD)}).ilike("wallet_address",referrer);
    }
    afterApprove(userWallet);
    showMsg($("pay-msg"),"ok",isOg?"Verified. You are OG.":"Verified. OG is full.");
    await loadStats();await loadBoard();
  }catch(e){showMsg($("pay-msg"),"err",e.message||"Verify failed")}
  finally{this.disabled=false;this.textContent="PAY $0.25 AND VERIFY"}
};
function afterApprove(w){$("ref-wrap").style.display="block";$("ref-link").textContent=SITE+"?ref="+w.toLowerCase();showStep("pay");loadMine()}
$("copy-ref").onclick=async function(){try{await navigator.clipboard.writeText($("ref-link").textContent);this.textContent="COPIED"}catch(_){prompt("Copy",$("ref-link").textContent)}};
async function loadMine(){
  if(!userWallet)return;
  try{
    const {data}=await db.from("users").select("verification_status").ilike("wallet_address",userWallet).maybeSingle();
    if(data&&data.verification_status==="verified"){$("ref-wrap").style.display="block";$("ref-link").textContent=SITE+"?ref="+userWallet.toLowerCase();showStep("pay")}
    const {count}=await db.from("referrals").select("*",{count:"exact",head:true}).eq("referrer_wallet",userWallet.toLowerCase()).eq("status","paid");
    const refs=count||0;
    const earned=refs*REF_USD;
    let reserved=0;
    try{const wr=await db.from("withdraw_requests").select("amount_usd,status").eq("wallet",userWallet.toLowerCase()).in("status",["pending","paid"]);(wr.data||[]).forEach(r=>reserved+=Number(r.amount_usd||0))}catch(_){}
    const available=Math.max(0,earned-reserved);
    $("earn-line").textContent="Referrals: "+refs+" · Available: $"+available.toFixed(2);
    const btn=$("withdraw-btn");
    if(available+1e-9>=WD_MIN){btn.disabled=false;btn.textContent="WITHDRAW $"+available.toFixed(2)}
    else{btn.disabled=true;btn.textContent="WITHDRAW AT $2 · now $"+available.toFixed(2)}
  }catch(_){}
}
$("withdraw-btn").onclick=async function(){
  if(!userWallet)return;
  this.disabled=true;
  try{
    const {count}=await db.from("referrals").select("*",{count:"exact",head:true}).eq("referrer_wallet",userWallet.toLowerCase()).eq("status","paid");
    const earned=(count||0)*REF_USD;
    let reserved=0;
    try{const wr=await db.from("withdraw_requests").select("amount_usd").eq("wallet",userWallet.toLowerCase()).in("status",["pending","paid"]);(wr.data||[]).forEach(r=>reserved+=Number(r.amount_usd||0))}catch(_){}
    const available=Math.max(0,earned-reserved);
    if(available<WD_MIN)throw new Error("Need $2");
    if(CONTRACT_ADDRESS&&provider){
      await switchChain();
      const signer=await provider.getSigner();
      const pool=new ethers.Contract(CONTRACT_ADDRESS,POOL_ABI,signer);
      await (await pool.withdraw()).wait();
      await db.from("withdraw_requests").insert({wallet:userWallet.toLowerCase(),amount_usd:Number(available.toFixed(2)),status:"paid"});
      showMsg($("wd-msg"),"ok","Sent to "+shortAddr(userWallet));
    }else{
      const {error}=await db.from("withdraw_requests").insert({wallet:userWallet.toLowerCase(),amount_usd:Number(available.toFixed(2)),status:"pending"});
      if(error)throw error;
      showMsg($("wd-msg"),"ok","Request saved. Instant send after Remix address is set.");
    }
    await loadMine();
  }catch(e){showMsg($("wd-msg"),"err",e.message||"Withdraw failed");this.disabled=false}
};
async function loadStats(){
  try{const q=await db.from("users").select("*",{count:"exact",head:true}).eq("verification_status","verified");$("joined-count").textContent=q.count||0;$("live-line").textContent=(q.count||0)+" wallets joined"}catch(_){}
  try{const q=await db.from("users").select("*",{count:"exact",head:true}).eq("verification_status","verified").eq("is_og",true);const og=q.count||0;if(og>=OG_CAP){$("og-box").classList.add("full");$("og-count").textContent="OG FULL"}else $("og-count").textContent=og+" / "+OG_CAP}catch(_){}
}
async function loadBoard(){
  try{
    const {data}=await db.from("users").select("wallet_address,referral_count,referral_earnings").gt("referral_count",0).order("referral_count",{ascending:false}).limit(15);
    const rows=data||[];
    $("board").innerHTML=rows.length?rows.map((r,i)=>"<div><span>"+(i+1)+". "+shortAddr(r.wallet_address)+"</span><span>"+r.referral_count+" refs · $"+Number(r.referral_earnings||0).toFixed(2)+"</span></div>").join(""):"<div>No referrals yet</div>";
  }catch(_){$("board").innerHTML="<div>No referrals yet</div>"}
}
renderRail();loadStats();loadBoard();
setInterval(()=>{loadStats();loadBoard();if(userWallet)loadMine()},5000);
