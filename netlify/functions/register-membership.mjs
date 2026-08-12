import crypto from "node:crypto";
import { google } from "googleapis";
import { membersFromMetadata, planFor } from "./_plans.mjs";

const required=(name)=>{const value=process.env[name];if(!value)throw new Error(`Falta la variable ${name}.`);return value;};
const tab=()=>process.env.GOOGLE_SHEET_TAB||"Hoja 1";
const sheetsClient=()=>{const credentials=JSON.parse(required("GOOGLE_SERVICE_ACCOUNT_JSON"));const auth=new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]});return google.sheets({version:"v4",auth});};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const memberCode=(prefix)=>`AL-${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const memberUrl=(origin,token)=>new URL(`/member/${token}`,origin).toString();

export default async(request)=>{
  try{
    if(request.method!=="POST")return json({error:"Método no permitido."},405);
    const body=await request.json();
    const planKey=String(body.plan||"").trim().toLowerCase();
    const plan=planFor(planKey);
    if(!plan)return json({error:"Membresía no válida."},400);
    if(!Array.isArray(body.members)||body.members.length!==plan.seats)return json({error:`Este plan requiere ${plan.seats} integrante(s).`},400);
    const metadata={};
    body.members.forEach((member,index)=>{const i=index+1;metadata[`member_${i}_name`]=String(member.name||"").trim();metadata[`member_${i}_email`]=String(member.email||"").trim().toLowerCase();metadata[`member_${i}_phone`]=String(member.phone||"").replace(/[^0-9+]/g,"");});
    const members=membersFromMetadata(metadata,plan.seats);
    const sheets=sheetsClient(),spreadsheetId=required("GOOGLE_SHEET_ID");
    const response=await sheets.spreadsheets.values.get({spreadsheetId,range:`${tab()}!A:Z`});
    const rows=response.data.values||[];
    const duplicate=members.find(member=>rows.slice(1).some(row=>String(row[5]||"").trim().toLowerCase()===member.email&&row[8]==="Activa"));
    if(duplicate)return json({error:`Ya existe una membresía activa para ${duplicate.email}. Usa Log in para entrar.`},409);
    const now=new Date().toISOString(),groupId=`grp_${crypto.randomUUID()}`,origin=(process.env.MEMBER_BASE_URL?.trim()||new URL(request.url).origin).replace(/\/$/,"");
    const records=members.map((member,index)=>{const token=crypto.randomBytes(24).toString("base64url"),code=memberCode(plan.prefix);return{name:member.name,email:member.email,level:plan.level,memberCode:code,token,memberUrl:memberUrl(origin,token),row:[`mem_${crypto.randomUUID()}`,"","","",member.name,member.email,member.phone,plan.level,"Activa",now,"",token,memberUrl(origin,token),code,"","",0,"Digital","",groupId,String(index+1),String(plan.seats),"registro-gratuito",planKey,0,0]};});
    await sheets.spreadsheets.values.append({spreadsheetId,range:`${tab()}!A:Z`,valueInputOption:"USER_ENTERED",requestBody:{values:records.map(record=>record.row)}});
    return json({ok:true,plan:planKey,level:plan.level,members:records.map(({row,...record})=>record)});
  }catch(error){console.error("register-membership",error);return json({error:"No pudimos crear la membresía. Intenta nuevamente."},500);}
};