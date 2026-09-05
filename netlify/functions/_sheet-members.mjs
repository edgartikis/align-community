import { google } from "googleapis";

const required=(name)=>{const value=process.env[name];if(!value)throw new Error(`Falta la variable ${name}.`);return value;};
const tab=()=>process.env.GOOGLE_SHEET_TAB||"Hoja 1";
const sheetsClient=()=>{const credentials=JSON.parse(required("GOOGLE_SERVICE_ACCOUNT_JSON"));const auth=new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]});return google.sheets({version:"v4",auth});};
const spreadsheetId=()=>required("GOOGLE_SHEET_ID");

export const rowToMember=(row)=>({
  id:row[0]||"",token:row[11]||"",memberCode:row[13]||"",name:row[4]||"",email:row[5]||"",phone:row[6]||"",level:row[7]||"",status:row[8]||"",joinedAt:row[9]||"",photoUrl:row[18]||"",savings:Number(row[16]||0),groupId:row[19]||"",position:Number(row[20]||1),seats:Number(row[21]||1),source:row[22]||"google-sheet"
});

export async function getRows(){const sheets=sheetsClient();const response=await sheets.spreadsheets.values.get({spreadsheetId:spreadsheetId(),range:`${tab()}!A:Z`});return response.data.values||[];}
export async function findByCode(memberCode){const code=String(memberCode||"").trim().toUpperCase();const rows=await getRows();const row=rows.slice(1).find(r=>String(r[13]||"").trim().toUpperCase()===code);return row?rowToMember(row):null;}
export async function findByToken(token){const rows=await getRows();const row=rows.slice(1).find(r=>String(r[11]||"")===String(token||""));return row?rowToMember(row):null;}
export async function findGroup(groupId){const rows=await getRows();return rows.slice(1).filter(r=>String(r[19]||"")===String(groupId||"")).map(rowToMember).sort((a,b)=>a.position-b.position);}
export async function appendMembers(records){if(!records?.length)return;const sheets=sheetsClient();await sheets.spreadsheets.values.append({spreadsheetId:spreadsheetId(),range:`${tab()}!A:Z`,valueInputOption:"USER_ENTERED",requestBody:{values:records}});}
export async function updatePhotoByToken(token,photo){const sheets=sheetsClient();const rows=await getRows();const index=rows.findIndex((r,i)=>i>0&&String(r[11]||"")===String(token||""));if(index<1)return false;const rowNumber=index+1;await sheets.spreadsheets.values.update({spreadsheetId:spreadsheetId(),range:`${tab()}!S${rowNumber}`,valueInputOption:"RAW",requestBody:{values:[[photo]]}});return true;}
