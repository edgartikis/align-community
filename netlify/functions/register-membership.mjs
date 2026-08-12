import crypto from "node:crypto";
import { membersFromMetadata, planFor } from "./_plans.mjs";
import { codeKey, emailKey, indexStore, membersStore, readJson } from "./_member-store.mjs";

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const memberCode=(prefix)=>`AL-${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

export default async(request)=>{
  try{
    if(request.method!=="POST")return json({error:"Método no permitido."},405);
    const body=await request.json(),planKey=String(body.plan||"").trim().toLowerCase(),plan=planFor(planKey);
    if(!plan)return json({error:"Membresía no válida."},400);
    if(!Array.isArray(body.members)||body.members.length!==plan.seats)return json({error:`Este plan requiere ${plan.seats} integrante(s).`},400);
    const metadata={};body.members.forEach((member,index)=>{const i=index+1;metadata[`member_${i}_name`]=String(member.name||"").trim();metadata[`member_${i}_email`]=String(member.email||"").trim().toLowerCase();metadata[`member_${i}_phone`]=String(member.phone||"").replace(/[^0-9+]/g,"");});
    const members=membersFromMetadata(metadata,plan.seats),records=membersStore(),lookup=indexStore();
    for(const member of members){if(await readJson(lookup,emailKey(member.email)))return json({error:`Ya existe una cuenta para ${member.email}. Usa Log in para entrar.`},409);}
    const now=new Date().toISOString(),groupId=`grp_${crypto.randomUUID()}`;
    const created=[];
    for(let index=0;index<members.length;index++){const person=members[index],token=crypto.randomBytes(24).toString("base64url"),memberCodeValue=memberCode(plan.prefix),record={id:`mem_${crypto.randomUUID()}`,token,memberCode:memberCodeValue,name:person.name,email:person.email,phone:person.phone,level:plan.level,planKey,status:"Activa",joinedAt:now,photoUrl:"",savings:0,groupId,position:index+1,seats:plan.seats,source:"registro-gratuito"};await records.set(token,JSON.stringify(record));await lookup.set(codeKey(memberCodeValue),JSON.stringify({token}));await lookup.set(emailKey(person.email),JSON.stringify({token}));created.push({name:record.name,email:record.email,level:record.level,memberCode:record.memberCode,token:record.token,memberUrl:`${new URL(request.url).origin}/member/${record.token}`});}
    return json({ok:true,plan:planKey,level:plan.level,members:created});
  }catch(error){console.error("register-membership",error);return json({error:"No pudimos crear la membresía. Intenta nuevamente."},500);}
};