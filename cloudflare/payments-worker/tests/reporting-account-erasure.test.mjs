import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Offline Apps Script integration test: no Google Sheets account, deployment,
// webhook or live information is accessed.
const source=readFileSync(new URL("../../../integrations/align-production-db/Code.gs",import.meta.url),"utf8");
function fakeSheets() {
  const files={
    SOCIOS:[
      ["STRIPE-cus_del","qa.delete.fixture2","Delete User","The Brotherhood","Activo","","",0,0,0,0,0,0,"","","","old-hash","cus_del","sub_del"],
      ["STRIPE-cus_other","other.account","Other Member","The Brotherhood","Activo","","",0,0,0,0,0,0,"","","","other-hash","cus_other","sub_other"],
    ],
    AFILIADOS:[
      ["DEL-P1","STRIPE-cus_del","qa.delete.fixture2","Delete User","Titular","AL-DEL","Activo","del@example.invalid","123","secret-member-token"],
      ["OTH-P1","STRIPE-cus_other","other.account","Other Member","Titular","AL-OTHER","Activo","other@example.invalid","234","safe-token"],
    ],
    PAGOS:[
      ["pay_delete","2026-10-19","STRIPE-cus_del","qa.delete.fixture2","The Brotherhood",249,"MXN","Pagado","Stripe","","cus_del","sub_del"],
      ["pay_other","2026-10-19","STRIPE-cus_other","other.account","The Brotherhood",249,"MXN","Pagado","Stripe","","cus_other","sub_other"],
    ],
    VISITAS:[
      ["vis_del","2026-10-19","STRIPE-cus_del","DEL-P1","qa.delete.fixture2","Delete User","Brotherhood","ally1","Ally","food",1,249,24,"promo","Cloudflare","Private note about deletion user"],
      ["vis_other","2026-10-19","STRIPE-cus_other","OTH-P1","other.account","Other Member","Brotherhood","ally1","Ally","food",1,249,24,"promo","Cloudflare","Other note"],
    ],
    ALIADOS:[],
  };
  class Sheet {
    constructor(name){this.name=name;this.rows=files[name];}
    getLastRow(){return Math.max(4,this.rows.length+4);}
    getRange(row,col,numRows=1,numCols=1){
      const sheet=this;
      return {
        getValues(){return Array.from({length:numRows},(_,r)=>Array.from({length:numCols},(_,c)=>
          (sheet.rows[row-5+r]||[])[col-1+c]??""));},
        getValue(){return (sheet.rows[row-5]||[])[col-1]??"";},
        setValues(values){
          for(let r=0;r<numRows;r++){
            const idx=row-5+r;
            if(idx<0) continue; // header area
            while(sheet.rows.length<=idx)sheet.rows.push([]);
            for(let c=0;c<numCols;c++)sheet.rows[idx][col-1+c]=values[r][c];
          }
          return this;
        },
        setValue(v){return this.setValues([[v]])},
        setFontWeight(){return this},
        clearContent(){
          for(let r=0;r<numRows;r++){
            const idx=row-5+r;if(idx<0)continue;
            while(sheet.rows.length<=idx)sheet.rows.push([]);
            for(let c=0;c<numCols;c++)sheet.rows[idx][col-1+c]="";
          }
          return this;
        },
      };
    }
  }
  const sheets={};
  for(const name of Object.keys(files))sheets[name]=new Sheet(name);
  const db={getSheetByName:name=>sheets[name],insertSheet:name=>{throw Error("Unexpected sheet "+name)}};
  return {files,spreadsheet:db};
}
function setup() {
  const fake=fakeSheets();
  const context={
    SpreadsheetApp:{openById:()=>fake.spreadsheet},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==="SPREADSHEET_ID"?"fake-spreadsheet":"mock-secret"})},
    ContentService:{},
  };
  runInNewContext(source+"\nthis.__anonymizeAccount = anonymizeAccount_; this.__preflight = preflightAccountErasure_;",context);
  return {...fake,anonymizeAccount:context.__anonymizeAccount,preflight:context.__preflight};
}

test("reporting sheet anonymizes only one member and affiliates while retaining required accounting amounts",()=>{
  const s=setup();
  const v=s.anonymizeAccount({username:"qa.delete.fixture2",stripeCustomerId:"cus_del"});
  assert.equal(v.ok,true);
  assert.deepEqual(JSON.parse(JSON.stringify(v.counts)),{socios:1,afiliados:1,visitas:1,pagos:1});
  assert.equal(s.files.SOCIOS[0][1],"");
  assert.equal(s.files.AFILIADOS[0][7],"");
  assert.equal(s.files.VISITAS[0][5],"Cuenta eliminada");
  assert.equal(s.files.VISITAS[0][2],"");
  assert.equal(s.files.VISITAS[0][15],"");
  assert.equal(s.files.VISITAS[0][11],249);
  assert.equal(s.files.PAGOS[0][2],"");
  assert.equal(s.files.PAGOS[0][3],"");
  assert.equal(s.files.PAGOS[0][5],249);
  assert.equal(s.files.SOCIOS[1][1],"other.account");
  assert.equal(s.files.AFILIADOS[1][7],"other@example.invalid");
  assert.equal(s.files.VISITAS[1][5],"Other Member");
  assert.equal(s.files.PAGOS[1][3],"other.account");
});

test("secondary report erasure rejects mismatched Stripe identity before clearing any rows",()=>{
  const s=setup();
  assert.throws(()=>s.anonymizeAccount({username:"qa.delete.fixture2",stripeCustomerId:"cus_wrong"}),
    /Stripe no coincide/);
  assert.equal(s.files.SOCIOS[0][1],"qa.delete.fixture2");
  assert.equal(s.files.AFILIADOS[0][7],"del@example.invalid");
  assert.equal(s.files.VISITAS[0][5],"Delete User");
});

test("secondary report erasure rejects invalid usernames and Stripe customer IDs",()=>{
  const s=setup();
  assert.throws(()=>s.anonymizeAccount({username:"",stripeCustomerId:"cus_del"}),/Cuenta no válida/);
  assert.throws(()=>s.anonymizeAccount({username:"qa.delete.fixture2",stripeCustomerId:"cus_#!"}),/Stripe Customer no válido/);
});

test("read-only production preflight verifies a unique username and Stripe customer",()=>{
  const s=setup();
  const snapshot=JSON.stringify(s.files);
  const result=s.preflight({username:"qa.delete.fixture2",stripeCustomerId:"cus_del"});
  assert.equal(result.ok,true);
  assert.equal(result.eligible,true);
  assert.equal(result.capability,"account-erasure-v1");
  assert.equal(JSON.stringify(s.files),snapshot,"Preflight must be read-only");
});

test("read-only production preflight rejects wrong customer and missing member",()=>{
  const s=setup();
  assert.throws(()=>s.preflight({username:"qa.delete.fixture2",stripeCustomerId:"cus_other"}),
    /Conflicto de identidad/);
  assert.throws(()=>s.preflight({username:"qa.not.in.sheet",stripeCustomerId:"cus_del"}),
    /coincidencia única/);
  assert.equal(s.files.SOCIOS[0][1],"qa.delete.fixture2");
});
