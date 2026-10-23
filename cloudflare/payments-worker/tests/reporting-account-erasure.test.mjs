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
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>
      key==="SPREADSHEET_ID" ? "fake-spreadsheet" :
      key==="ALIGN_DB_SECRET" ? "billing-test-secret" :
      key==="ALIGN_DB_DELETION_SECRET" ? "deletion-only-fixture-credential-at-least-32-chars" : ""
    })},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    ContentService:{
      MimeType:{JSON:"application/json"},
      createTextOutput:payload=>({
        payload,
        setMimeType(){return this;},
        getContent(){return this.payload;}
      }),
    },
  };
  runInNewContext(source+"\nthis.__anonymizeAccount = anonymizeAccount_; this.__preflight = preflightAccountErasure_; this.__doPost = doPost;",context);
  return {...fake,anonymizeAccount:context.__anonymizeAccount,preflight:context.__preflight,doPost:context.__doPost};
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
    /Conflicto de identidad/);
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
  assert.throws(()=>s.preflight({username:"qa.not.in.sheet",stripeCustomerId:"cus_unknown"}),
    /coincidencia única/);
  assert.equal(s.files.SOCIOS[0][1],"qa.delete.fixture2");
});

test("stale affiliate username pointing at another group blocks preflight and erasure",()=>{
  const s=setup();
  s.files.AFILIADOS.push(["FOREIGN-P1","STRIPE-cus_other","qa.delete.fixture2",
    "Another Member","Titular","AL-FOREIGN","Activo","other@example.invalid"]);
  const before=JSON.stringify(s.files);
  const identity={username:"qa.delete.fixture2",stripeCustomerId:"cus_del"};
  assert.throws(()=>s.preflight(identity),/otro socio/);
  assert.throws(()=>s.anonymizeAccount(identity),/otro socio/);
  assert.equal(JSON.stringify(s.files),before,"Neither path may modify an unrelated group");
});

test("mixed-ownership visit blocks all mutations, even target payment or affiliate",()=>{
  const s=setup();
  s.files.VISITAS.push(["vis_mixed","2026-10-20","STRIPE-cus_del","OTHER-P1",
    "other.account","Another Member"]);
  const before=JSON.stringify(s.files);
  const identity={username:"qa.delete.fixture2",stripeCustomerId:"cus_del"};
  assert.throws(()=>s.preflight(identity),/otro socio/);
  assert.throws(()=>s.anonymizeAccount(identity),/otro socio/);
  assert.equal(JSON.stringify(s.files),before);
});

test("payment with same user and mismatching Stripe customer fails before all writes",()=>{
  const s=setup();
  s.files.PAGOS.push(["pay_bad","2026-10-20","STRIPE-cus_del",
    "qa.delete.fixture2","The Brotherhood",249,"MXN","Pagado","Stripe","",
    "cus_other","sub_other"]);
  const before=JSON.stringify(s.files);
  const identity={username:"qa.delete.fixture2",stripeCustomerId:"cus_del"};
  assert.throws(()=>s.preflight(identity),/otro socio/);
  assert.throws(()=>s.anonymizeAccount(identity),/otro socio/);
  assert.equal(JSON.stringify(s.files),before);
});

test("Stripe customer linked to a second username prevents any erasure",()=>{
  const s=setup();
  s.files.SOCIOS.push(["STRIPE-cus_new","another.username","Another", "Circle",
    "Activo","","",0,0,0,0,0,0,"","","","","cus_del","sub_other"]);
  const before=JSON.stringify(s.files);
  const identity={username:"qa.delete.fixture2",stripeCustomerId:"cus_del"};
  assert.throws(()=>s.preflight(identity),/Conflicto de identidad/);
  assert.throws(()=>s.anonymizeAccount(identity),/Conflicto de identidad/);
  assert.equal(JSON.stringify(s.files),before);
});

test("routine billing credential NEVER authorizes account deletion",()=>{
  const s=setup();
  const before=JSON.stringify(s.files);
  const invoke=action=>s.doPost({postData:{contents:JSON.stringify({
    mode:"ALIGN_PROD_2026",secret:"billing-test-secret",action,
    username:"qa.delete.fixture2",stripeCustomerId:"cus_del"
  })}});
  for(const action of ["preflight_account_erasure","anonymize_account"]){
    const result=JSON.parse(invoke(action).getContent());
    assert.equal(result.ok,false);
    assert.match(result.error,/Solicitud no autorizada/);
    assert.equal(JSON.stringify(s.files),before,"Billing credential must not modify any sheet");
  }
});

test("independent deletion credential permits read-only preflight",()=>{
  const s=setup();
  const before=JSON.stringify(s.files);
  const result=JSON.parse(s.doPost({postData:{contents:JSON.stringify({
    mode:"ALIGN_PROD_2026",secret:"deletion-only-fixture-credential-at-least-32-chars",
    action:"preflight_account_erasure",username:"qa.delete.fixture2",stripeCustomerId:"cus_del"
  })}}).getContent());
  assert.equal(result.ok,true);
  assert.equal(result.capability,"account-erasure-v1");
  assert.equal(result.eligible,true);
  assert.equal(JSON.stringify(s.files),before);
});

test("ordinary membership payment status remains authorized by existing billing key",()=>{
  const s=setup();
  const result=JSON.parse(s.doPost({postData:{contents:JSON.stringify({
    mode:"ALIGN_PROD_2026",secret:"billing-test-secret",
    action:"subscription_status",stripeSubscriptionId:""
  })}}).getContent());
  assert.equal(result.ok,true);
  assert.equal(result.missing,true);
});
