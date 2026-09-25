import crypto from "node:crypto";
import { membersFromMetadata, planFor } from "./_plans.mjs";
import { codeKey, emailKey, groupsStore, indexStore, membersStore, readJson, usernameKey } from "./_member-store.mjs";
import { appendMembers } from "./_sheet-members.mjs";

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const memberCode=(prefix)=>`AL-${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

export default async(request)=>{
  try{
    if(request.method!=="POST")return json({error:"Método no permitido."},405);
    const body=await request.json(),planKey=String(body.plan||"").trim().toLowerCase(),plan=planFor(planKey);
    if(!plan)return json({error:"Membresía no válida."},400);
    if(!Array.isArray(body.members)||body.members.length!==plan.seats)return json({error:`Este plan requiere ${plan.seats} integrante(s).`},400);const username=String(body.account?.username||"").trim().toLowerCase(),password=String(body.account?.password||"");if(!/^[a-z0-9._]{4,24}$/.test(username))return json({error:"El nombre de usuario no es válido."},400);if(password.length<8||!/[a-záéíóúñ]/i.test(password)||!/\d/.test(password))return json({error:"La contraseña debe tener al menos 8 caracteres, una letra y un número."},400);
    const metadata={};body.members.forEach((member,index)=>{const i=index+1;metadata[`member_${i}_name`]=String(member.name||"").trim();metadata[`member_${i}_email`]=String(member.email||"").trim().toLowerCase();metadata[`member_${i}_phone`]=String(member.phone||"").replace(/[^0-9+]/g,"");});
    const members=membersFromMetadata(metadata,plan.seats),records=membersStore(),lookup=indexStore();
    for(const member of members){if(await readJson(lookup,emailKey(member.email)))return json({error:`Ya existe una cuenta para ${member.email}. Usa Log in para entrar.`},409);}if(await readJson(lookup,usernameKey(username)))return json({error:"Ese nombre de usuario ya está registrado."},409);const passwordSalt=crypto.randomBytes(16).toString("hex"),passwordHash=crypto.scryptSync(password,passwordSalt,64).toString("hex");
    const now=new Date().toISOString(),groupId=`grp_${crypto.randomUUID()}`;
    const created=[],sheetRows=[];
    for(let index=0;index<members.length;index++){
      const person=members[index],token=crypto.randomBytes(24).toString("base64url"),memberCodeValue=memberCode(plan.prefix),id=`mem_${crypto.randomUUID()}`;
      const record={id,token,memberCode:memberCodeValue,name:person.name,email:person.email,phone:person.phone,level:plan.level,planKey,status:"Activa",joinedAt:now,photoUrl:"",savings:0,groupId,position:index+1,seats:plan.seats,source:"registro-gratuito",...(index===0?{username,passwordSalt,passwordHash}:{})};
      await records.set(token,JSON.stringify(record));await lookup.set(codeKey(memberCodeValue),JSON.stringify({token}));if(index===0)await lookup.set(usernameKey(username),JSON.stringify({token}));await lookup.set(emailKey(person.email),JSON.stringify({token}));
      created.push({name:record.name,email:record.email,level:record.level,memberCode:record.memberCode,token:record.token,memberUrl:`${new URL(request.url).origin}/member/${record.token}`});
      sheetRows.push([id,"","","",person.name,person.email,person.phone,plan.level,"Activa",now,"",token,`${new URL(request.url).origin}/member/${token}`,memberCodeValue,"","",0,"Digital","",groupId,String(index+1),String(plan.seats),"registro-gratuito","",0,0]);
    }
    await groupsStore().set(groupId,JSON.stringify({groupId,planKey,level:plan.level,primaryToken:created[0].token,tokens:created.map(member=>member.token),username}));
    await appendMembers(sheetRows);
    return json({ok:true,plan:planKey,level:plan.level,primaryToken:created[0].token,members:created});
  }catch(error){console.error("register-membership",error);return json({error:"No pudimos crear la membresía. Intenta nuevamente."},500);}
};