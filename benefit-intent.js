(function(){
  const API='https://api.alignmembers.com.mx/api';
  const ALLY_BY_PATH={
    'horse-riding.html':'horse',
    'cera-mia.html':'ceramia',
    'nuva.html':'nuva',
    'sante.html':'sante',
    'laura-nader.html':'nuvello',
    'la-luxeria.html':'luxeria',
    'uspin.html':'uspin',
    'jessica-manzur.html':'dentistajessica',
    'padel-11-11.html':'padel',
    'green-cabana.html':'greencabana'
  };

  function memberToken(){
    const params=new URLSearchParams(location.search);
    return params.get('token')||sessionStorage.getItem('align_member_token')||localStorage.getItem('align_primary_token')||'';
  }

  function pathKey(){
    const name=(location.pathname.split('/').pop()||'').toLowerCase();
    return ALLY_BY_PATH[name]||'';
  }

  function benefitFromWhatsApp(url){
    try{
      const parsed=new URL(url,location.href);
      const text=parsed.searchParams.get('text')||'';
      const match=text.match(/beneficio(?:\s+de|\s+con)?\s+(.+?)(?:\.\s*¿|\.\s*\?|$)/i);
      return (match&&match[1]?match[1]:text).trim().slice(0,220);
    }catch(_){return '';}
  }

  async function createIntent(allyKey,benefit){
    const token=memberToken();
    if(!token) throw new Error('Para solicitar un beneficio debes entrar desde tu portal ALIGN.');
    const response=await fetch(API+'/benefit-intent',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({memberToken:token,allyKey,benefit})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok) throw new Error(data.error||'No fue posible generar el folio ALIGN.');
    return data;
  }

  function withFolio(destination,intent){
    if(/^https:\/\/wa\.me\//i.test(destination)){
      const parsed=new URL(destination);
      const original=parsed.searchParams.get('text')||'';
      const suffix='\n\nFolio ALIGN: '+intent.intentId+'\nBeneficio sujeto a validación del QR vigente al momento de pagar.';
      parsed.searchParams.set('text',original+suffix);
      return parsed.toString();
    }
    return destination;
  }

  function showError(message){
    window.alert(message);
  }

  function wire(link,allyKey){
    if(link.dataset.alignIntentReady==='1') return;
    const originalHref=link.getAttribute('href')||'';
    const explicit=link.dataset.alignBenefit||'';
    const benefit=explicit||benefitFromWhatsApp(originalHref);
    if(!benefit) return;
    link.dataset.alignIntentReady='1';
    link.addEventListener('click',async function(event){
      if(link.dataset.alignBusy==='1'){event.preventDefault();return;}
      event.preventDefault();
      const oldText=link.textContent;
      link.dataset.alignBusy='1';
      link.setAttribute('aria-busy','true');
      link.textContent='Generando folio ALIGN…';
      try{
        const intent=await createIntent(allyKey,benefit);
        const target=withFolio(originalHref,intent);
        link.textContent='Folio '+intent.intentId;
        setTimeout(()=>{location.href=target;},120);
      }catch(error){
        link.textContent=oldText;
        link.dataset.alignBusy='0';
        link.removeAttribute('aria-busy');
        showError(error&&error.message?error.message:'No fue posible solicitar el beneficio.');
      }
    });
  }

  const allyKey=pathKey();
  if(!allyKey) return;

  document.querySelectorAll('a[href*="wa.me/"]').forEach(link=>wire(link,allyKey));
  document.querySelectorAll('a[data-align-benefit]').forEach(link=>wire(link,allyKey));
})();