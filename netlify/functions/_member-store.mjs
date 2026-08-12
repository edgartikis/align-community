import { getStore } from "@netlify/blobs";

export const membersStore=()=>getStore({name:"align-members",consistency:"strong"});
export const groupsStore=()=>getStore({name:"align-groups",consistency:"strong"});\nexport const indexStore=()=>getStore({name:"align-member-index",consistency:"strong"});
export const readJson=async(store,key)=>{const value=await store.get(key);return value?JSON.parse(value):null;};
export const codeKey=(code)=>`code-${String(code||"").trim().toUpperCase()}`;
export const emailKey=(email)=>`email-${String(email||"").trim().toLowerCase()}`;
