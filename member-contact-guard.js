(function(){
  'use strict';
  const API='https://api.alignmembers.com.mx/api';
  const contactUrl=/^(?:tel:|mailto:|https?:\/\/(?:wa\.me|wa\.link|api\.whatsapp\.com|web\.whatsapp\.com|(?:www\.)?instagram\.com|(?:www\.)?calendly\.com|(?:www\.)?booksy\.com)\/)/i;
  const originalLinks=new WeakMap();
  const replaying=new WeakSet();
  let verifiedUntil=0;
  let pending=null;

  function session(){
    return {
      member:sessionStorage.getItem('align_member_token')||'',
      login:sessionStorage.getItem('align_billing_session')||''
    };
  }
  function protect(link){
    const href=link.getAttribute('href')||'';
    if(!contactUrl.test(href)||originalLinks.has(link))return;
    originalLinks.set(link,href);
    link.setAttribute('href','#solo-socios');
    link.setAttribute('data-align-contact-protected','1');
    link.setAttribute('aria-label',(link.getAttribute('aria-label')||link.textContent.trim()||'Contactar')+' · solo socios ALIGN');
  }
  function scan(){
    document.querySelectorAll('a[href]').forEach(protect);
  }
  async function verifyActiveSession(){
    const credentials=session();
    if(!credentials.member||!credentials.login)throw new Error('Inicia sesión como socio ALIGN para solicitar reservaciones o contactar a nuestros aliados.');
    if(Date.now()<verifiedUntil)return;
    if(pending)return pending;
    pending=(async()=>{
      const auth=await fetch(API+'/member-billing',{
        method:'GET',cache:'no-store',
        headers:{authorization:'Bearer '+credentials.login}
      });
      const billing=await auth.json().catch(()=>({}));
      if(!auth.ok||!billing.ok)throw new Error('Tu sesión venció. Vuelve a iniciar sesión en ALIGN.');
      const response=await fetch(API+'/member-card?token='+encodeURIComponent(credentials.member),{cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.active)throw new Error('Para solicitar beneficios necesitas una membresía ALIGN vigente.');
      verifiedUntil=Date.now()+30000;
    })();
    try{await pending}finally{pending=null}
  }
  function offerLogin(message){
    if(window.confirm(message+'\n\n¿Quieres iniciar sesión ahora?'))location.assign('login.html');
  }
  document.addEventListener('click',async(event)=>{
    const link=event.target.closest&&event.target.closest('a');
    if(!link)return;
    if(!originalLinks.has(link))protect(link);
    const destination=originalLinks.get(link);
    if(!destination)return;
    if(replaying.has(link)){replaying.delete(link);return;}
    event.preventDefault();
    event.stopImmediatePropagation();
    const credentials=session();
    if(!credentials.member||!credentials.login){
      offerLogin('Las reservaciones y el contacto con aliados son beneficios exclusivos para socios ALIGN.');
      return;
    }
    if(link.dataset.alignContactBusy==='1')return;
    link.dataset.alignContactBusy='1';
    link.setAttribute('aria-busy','true');
    try{
      await verifyActiveSession();
      if(link.dataset.alignIntentReady==='1'){
        replaying.add(link);
        link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      }else{
        location.assign(destination);
      }
    }catch(error){
      offerLogin(error&&error.message?error.message:'No pudimos validar tu membresía ALIGN.');
    }finally{
      link.dataset.alignContactBusy='0';
      link.removeAttribute('aria-busy');
    }
  },true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});
  else scan();
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();