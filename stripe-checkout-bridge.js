(function(){
  const API='https://api.alignmembers.com.mx/api/checkout';
  const path=String(location.pathname||'');
  if(!path.endsWith('/pago.html')&&!path.endsWith('pago.html'))return;

  const sha256=async value=>{
    const bytes=new TextEncoder().encode(String(value||''));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  };

  const start=()=>{
    const q=new URLSearchParams(location.search);
    const plan=String(q.get('plan')||'').toLowerCase();
    if(!plan)return;

    const draftKey='align_registration_draft_'+plan;
    let draft=null;
    try{draft=JSON.parse(sessionStorage.getItem(draftKey)||'null')}catch(_){draft=null}

    const apple=document.getElementById('apple');
    const manualBox=document.querySelector('.manualbox');
    const separator=document.querySelector('.or');
    const hint=document.querySelector('.hint');
    const methodsLead=document.querySelector('.methods>p');
    const headingCopy=document.querySelector('.heading>p:last-child');
    const eyebrow=document.querySelector('.heading .eyebrow');
    const note=document.querySelector('.summary .note');
    const status=document.getElementById('status');
    const error=document.getElementById('error');

    if(eyebrow)eyebrow.textContent='Pago seguro / Sandbox';
    if(headingCopy)headingCopy.textContent='Serás redirigido al Checkout seguro de Stripe para completar tu suscripción mensual de prueba.';
    if(methodsLead)methodsLead.textContent='Continúa al checkout seguro. Ahí podrás pagar con tarjeta y, cuando esté disponible, Apple Pay.';
    if(hint)hint.textContent='Stripe maneja los datos de pago. ALIGN no almacena números de tarjeta.';
    if(note)note.innerHTML='<strong>Sandbox de Stripe.</strong><br>Esta prueba crea una suscripción TEST y no mueve dinero real.';
    if(separator)separator.style.display='none';
    if(manualBox)manualBox.style.display='none';

    const checkout=async()=>{
      try{
        if(error)error.textContent='';
        if(status)status.textContent='Preparando Checkout seguro de Stripe…';
        if(apple)apple.disabled=true;

        if(!draft||!Array.isArray(draft.members)||!draft.members.length)throw new Error('No encontramos los datos de integrantes. Regresa al paso anterior y vuelve a continuar.');

        const username=String(document.getElementById('user')?.value||'').trim().toLowerCase();
        const password=String(document.getElementById('pass')?.value||'');
        const confirmation=String(document.getElementById('confirm')?.value||'');
        const consent=Boolean(document.getElementById('consent')?.checked);

        if(!/^[a-z0-9._-]{4,24}$/i.test(username))throw new Error('El usuario debe tener de 4 a 24 caracteres.');
        if(password.length<8||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password))throw new Error('La contraseña debe tener mínimo 8 caracteres, una letra y un número.');
        if(password!==confirmation)throw new Error('Las contraseñas no coinciden.');
        if(!consent)throw new Error('Marca la casilla del Aviso de Privacidad para continuar.');

        const passwordHash=await sha256(password);
        const response=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plan,username,passwordHash,members:draft.members})});
        const text=await response.text();
        let data;try{data=JSON.parse(text)}catch(_){data={error:text}}
        if(!response.ok||!data?.url)throw new Error(data?.error||'No se pudo abrir Stripe Checkout.');

        sessionStorage.setItem('align_sandbox_account_'+plan,JSON.stringify({username,passwordHash}));
        location.assign(data.url);
      }catch(e){
        console.error('ALIGN Stripe Checkout:',e);
        if(error)error.textContent=e?.message||'No se pudo iniciar el pago.';
        if(status)status.textContent='';
        if(apple)apple.disabled=false;
      }
    };

    if(apple){
      const label=apple.querySelector('span');
      if(label)label.textContent='Continuar a Stripe';
      apple.onclick=checkout;
    }
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
