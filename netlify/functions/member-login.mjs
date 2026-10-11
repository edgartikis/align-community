import crypto from "node:crypto";
import { codeKey, emailKey, groupsStore, indexStore, membersStore, readJson, usernameKey } from "./_member-store.mjs";
import { findByCode, findGroup } from "./_sheet-members.mjs";

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const planKeyFromLevel=(level)=>({"The Brotherhood":"brotherhood","Girls Club":"girls","Ranch Club":"ranch","Duo Club":"duo","Private Circle":"circle"}[level]||"circle");
const verifyPassword=(password,member)=>{try{if(!member.passwordSalt||!member.passwordHash)return false;const expected=Buffer.from(member.passwordHash,"hex"),actual=crypto.scryptSync(password,member.passwordSalt,expected.length);return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}catch{return false;}};

async function hydrateMember(member){
  const store=membersStore(),lookup=indexStore();member.planKey=member.planKey||planKeyFromLevel(member.level);
  await store.set(member.token,JSON.stringify(member));await lookup.set(codeKey(member.memberCode),JSON.stringify({token:member.token}));
  if(member.email)await lookup.set(emailKey(member.email),JSON.stringify({token:member.token}));
  if(member.groupId){const members=await findGroup(member.groupId);if(members.length){const tokens=[];for(const item of members){item.planKey=item.planKey||planKeyFromLevel(item.level);await store.set(item.token,JSON.stringify(item));await lookup.set(codeKey(item.memberCode),JSON.stringify({token:item.token}));if(item.email)await lookup.set(emailKey(item.email),JSON.stringify({token:item.token}));tokens.push(item.token);}await groupsStore().set(member.groupId,JSON.stringify({groupId:member.groupId,planKey:member.planKey,level:member.level,primaryToken:members[0].token,tokens}));}}
}

export default async(request)=>{
  try{
    if(request.method!=="POST")return json({error:"Método no permitido."},405);
    const body=await request.json(),username=String(body.username||body.memberCode||"").trim().toLowerCase(),password=String(body.password||"");
    if(!username||!password)return json({error:"Usuario o contraseña incorrectos."},401);
    let member=null;
    const pointer=await readJson(indexStore(),usernameKey(username));
    if(pointer?.token)member=await readJson(membersStore(),pointer.token);
    if(member){
      if(!verifyPassword(password,member))return json({error:"Usuario o contraseña incorrectos."},401);
    }else{
      const legacyCode=username.toUpperCase();
      if(legacyCode!==password.trim().toUpperCase())return json({error:"Usuario o contraseña incorrectos."},401);
      const legacyPointer=await readJson(indexStore(),codeKey(legacyCode));
      if(legacyPointer?.token)member=await readJson(membersStore(),legacyPointer.token);
      if(!member){member=await findByCode(legacyCode);if(member)await hydrateMember(member);}
    }
    if(!member||member.status!=="Activa")return json({error:"Membresía no encontrada o inactiva."},401);
    return json({ok:true,token:member.token,name:member.name,level:member.level,memberCode:member.memberCode});
  }catch(error){console.error("member-login",error);return json({error:"No pudimos iniciar sesión."},500);}
};