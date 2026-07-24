import { google } from "googleapis";

const required=(name)=>{const value=process.env[name];if(!value)throw new Error(`Falta la variable ${name}.`);return value;};
const tab=()=>process.env.GOOGLE_SHEET_TAB||"Hoja 1";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const sheetsClient=()=>{const credentials=JSON.parse(required("GOOGLE_SERVICE_ACCOUNT_JSON"));const auth=new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]});return google.sheets({version:"v4",auth});};

export default async(request)=>{
  try{
    if(request.method!=="POST")return json({error:"Método no permitido."},405);
    const body=await request.json();
    const token=String(body.token||"");
    const photo=String(body.photo||"");
    if(!/^[A-Za-z0-9_-]{20,}$/.test(token))return json({error:"Cuenta no válida."},400);
    if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo))return json({error:"Formato de foto no válido."},400);
    if(photo.length>45000)return json({error:"La foto es demasiado pesada. Intenta nuevamente."},413);

    const sheets=sheetsClient();
    const spreadsheetId=required("GOOGLE_SHEET_ID");
    const response=await sheets.spreadsheets.values.get({spreadsheetId,range:`${tab()}!A:S`});
    const rows=response.data.values||[];
    const index=rows.slice(1).findIndex((row)=>row[11]===token);
    if(index<0)return json({error:"Miembro no encontrado."},404);
    const row=rows[index+1];
    if(row[8]!=="Activa")return json({error:"La membresía no está activa."},403);

    const sheetRow=index+2;
    await sheets.spreadsheets.values.update({spreadsheetId,range:`${tab()}!S${sheetRow}`,valueInputOption:"RAW",requestBody:{values:[[photo]]}});
    return json({ok:true,memberUrl:row[12]||`/member/${token}`});
  }catch(error){console.error(error);return json({error:"No pudimos guardar tu foto."},500);}
};