// Deterministic controller tests with lightweight in-memory model mocks.
// No production database, network or credentials are accessed.
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const file = path.resolve(__dirname,'../src/controllers/examDutyController.js');
const makeId = c => c.repeat(24);
const ids = {a:makeId('a'), b:makeId('b'), c:makeId('c'), duplicate:makeId('d'), nukk:makeId('e'), nukkClash:makeId('f'), sid:makeId('1'), mmss:makeId('2'), jfm:makeId('3'), third:makeId('4'), nukkUser:makeId('5'), futureUser:makeId('6')};
const users = [{_id:ids.mmss,role:'teacher',shortCode:'MMSS',name:'Faculty MMSS'}, {_id:ids.jfm,role:'teacher',shortCode:'JFM',name:'Faculty JFM'}, {_id:ids.third,role:'teacher',shortCode:'ZZZ',name:'Third'}];
let sessions = [{_id:ids.sid,season:'Fall',year:2026,examType:'Mid Term',name:'Fall 2026',importedBy:ids.mmss}];
const mkRecord = (_id,date,course,room,invigilatorCodes)=>({ _id,session:ids.sid,date,day:'Sat',startTime:'10:00 AM',endTime:'11:30 AM',time:'10:00 AM – 11:30 AM',program:'B.Sc. in CSE',intake:'54',section:'1',course,room,category:'exam',invigilatorCodes,invigilators:invigilatorCodes.join(', '),updatedAt:new Date('2026-10-23') });
let records = [mkRecord(ids.a,'2026-10-24','CSE 101','2705',['MMSS','MMO']),mkRecord(ids.duplicate,'2026-10-24','CSE 101','2705',['MMSS','MMO']),mkRecord(ids.b,'2026-10-25','CSE 207','3706',['JFM']),mkRecord(ids.c,'2026-10-24','ENG 101','2709',['JFM']),mkRecord(ids.nukk,'2026-10-26','PHY 201','2710',['NUKK']),mkRecord(ids.nukkClash,'2026-10-24','CSE 303','2810',['NUKK'])];
let changes = [], proxies = [],seq=10;
const equal=(a,b)=>String(a)===String(b);
const match=(r,q={})=>Object.entries(q).every(([k,v])=>{
  if(k==='$or')return v.some(query=>match(r,query));
  if(Object.prototype.toString.call(v) === '[object RegExp]')return v.test(String(r[k]||''));
  if(v && typeof v==='object' && !(v instanceof Date)){
    if(v.$in)return v.$in.some(x=>Array.isArray(r[k])?r[k].some(y=>equal(y,x)):equal(r[k],x));
    return false;
  }
  return Array.isArray(r[k]) ? r[k].some(x=>equal(x,v)) : equal(r[k],v);
});
function query(data){return {select(){return this},sort(){return this},limit(){return this},lean(){return Promise.resolve(data)},then(resolve,reject){return Promise.resolve(data).then(resolve,reject)}}}
const models={
  '../models/User':{findOne:q=>query(users.find(x=>match(x,q))||null)},
  '../models/ExamDutySession':{
    find:q=>query(sessions.filter(x=>match(x,q))),findById:id=>query(sessions.find(x=>equal(x._id,id))||null),
    deleteOne:async q=>{const n=sessions.length;sessions=sessions.filter(x=>!match(x,q));return {deletedCount:n-sessions.length}},
  },
  '../models/ExamDutyRecord':{
    find:q=>query(records.filter(x=>match(x,q))),findOne:q=>query(records.find(x=>match(x,q))||null),
    countDocuments:async q=>records.filter(x=>match(x,q)).length,
    deleteMany:async q=>{const n=records.length;records=records.filter(x=>!match(x,q));return {deletedCount:n-records.length}},
  },
  '../models/ExamDutyProxy':{
    find:q=>query(proxies.filter(x=>match(x,q))),countDocuments:async q=>proxies.filter(x=>match(x,q)).length,
    deleteMany:async q=>{const n=proxies.length;proxies=proxies.filter(x=>!match(x,q));return {deletedCount:n-proxies.length}},
  },
  '../models/ExamDutyChange':{
    find:q=>query(changes.filter(x=>match(x,q))),exists:async q=>changes.some(x=>match(x,q)),
    create:async c=>{
      if(changes.some(x=>x.status==='active' && x.session===c.session && x.locks.some(key=>c.locks.includes(key)))){ const e=new Error('duplicate');e.code=11000;throw e; }
      const value={...c,_id:(++seq).toString(16).padStart(24,'0'),status:'active'};changes.push(value);return value;
    },
    findOneAndUpdate:async(q,update)=>{const v=changes.find(x=>match(x,q));if(v)Object.assign(v,update.$set);return v||null},
    deleteMany:async q=>{const n=changes.length;changes=changes.filter(x=>!match(x,q));return {deletedCount:n-changes.length}},
  }
};
const ctrl={};vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports:ctrl,console,Date,require:name=>name==='crypto'?require('crypto'):name==='../utils/examDutyBilling'?require('../src/utils/examDutyBilling'):name==='mongoose'?{isValidObjectId:v=>/^[0-9a-f]{24}$/.test(v)}:models[name]},{filename:file});
const res=()=>({statusCode:200,status(n){this.statusCode=n;return this},json(body){this.body=body;return this}});
const invoke=async(method,uid,params={},body={},query={})=>{const r=res();await ctrl[method]({user:{userId:uid},params:{id:ids.sid,...params},body,query},r);return r;};
(async()=>{
  let x=await invoke('mySchedule',ids.mmss);assert.equal(x.statusCode,200);assert.equal(x.body.rows.length,1,'legacy duplicate rows deduplicated');
  x=await invoke('createChange',ids.third,{}, {kind:'transfer',sourceRecordId:ids.a,targetCode:'JFM'});assert.equal(x.statusCode,403);
  x=await invoke('createChange',ids.mmss,{}, {kind:'exchange',sourceRecordId:ids.a,targetRecordId:ids.b,targetCode:'JFM'});
  assert.equal(x.statusCode,409);assert.equal(x.body.code,'DUTY_CONFLICT');assert.equal(x.body.theirConflicts.length,1);
  x=await invoke('createChange',ids.mmss,{}, {kind:'exchange',sourceRecordId:ids.a,targetRecordId:ids.b,targetCode:'JFM',allowConflict:true});assert.equal(x.statusCode,201);const exchangeId=x.body.changeId;
  x=await invoke('mySchedule',ids.mmss);assert.equal(x.body.rows.length,2);assert.equal(x.body.rows.filter(r=>r.assignment==='exchanged_out').length,1);assert.equal(x.body.rows.filter(r=>r.assignment==='exchange').length,1);
  x=await invoke('mySchedule',ids.jfm);assert.equal(x.body.rows.filter(r=>r.assignment==='exchange').length,1);assert.equal(x.body.rows.filter(r=>r.assignment==='exchanged_out').length,1);assert.equal(x.body.rows.filter(r=>r.conflicts.length>0).length,2);
  x=await invoke('createChange',ids.mmss,{}, {kind:'transfer',sourceRecordId:ids.duplicate,targetCode:'JFM',allowConflict:true});assert.equal(x.statusCode,409,'older PDF duplicate cannot bypass assignment lock');
  x=await invoke('revertChange',ids.third,{changeId:exchangeId});assert.equal(x.statusCode,404,'nonparticipant may not revert');
  x=await invoke('revertChange',ids.jfm,{changeId:exchangeId});assert.equal(x.statusCode,200,'recipient can revert');
  x=await invoke('mySchedule',ids.mmss);assert.equal(x.body.rows.length,1);assert.equal(x.body.rows[0].assignment,'official');
  x=await invoke('createChange',ids.mmss,{}, {kind:'transfer',sourceRecordId:ids.a,targetCode:'JFM'});assert.equal(x.statusCode,409,'target overlapping duty warns');
  x=await invoke('createChange',ids.mmss,{}, {kind:'transfer',sourceRecordId:ids.a,targetCode:'JFM',allowConflict:true});assert.equal(x.statusCode,201);const transferId=x.body.changeId;
  x=await invoke('mySchedule',ids.mmss);assert.equal(x.body.rows.length,1);assert.equal(x.body.rows[0].assignment,'transferred_out');
  x=await invoke('mySchedule',ids.jfm);assert.equal(x.body.rows.filter(r=>r.assignment==='transfer').length,1);
  x=await invoke('searchFaculty',ids.mmss,{}, {},{code:'JFM'});assert.equal(x.statusCode,200);assert.equal(x.body.faculty.shortCode,'JFM');
  x=await invoke('revertChange',ids.mmss,{changeId:transferId});assert.equal(x.statusCode,200);
  // V5: unregistered faculty with one or more published duties can exchange.
  x=await invoke('searchFaculty',ids.mmss,{}, {},{code:'NUKK'});
  assert.equal(x.statusCode,200);assert.equal(x.body.faculty,null);
  assert.equal(x.body.rows.length,2);assert.equal(x.body.peerSchedule.length,2);
  x=await invoke('createChange',ids.mmss,{}, {kind:'exchange',sourceRecordId:ids.a,targetRecordId:ids.nukk,targetCode:'NUKK'});
  assert.equal(x.statusCode,409,'unregistered faculty conflicts should still be detected');
  assert.equal(x.body.code,'DUTY_CONFLICT');assert.equal(x.body.theirConflicts.length,1);
  x=await invoke('createChange',ids.mmss,{}, {kind:'exchange',sourceRecordId:ids.a,targetRecordId:ids.nukk,targetCode:'NUKK',allowConflict:true});
  assert.equal(x.statusCode,201);assert.equal(x.body.recipientHasAccount,false);
  const offlineExchange=x.body.changeId;
  assert.equal(changes.find(c=>c._id===offlineExchange).toUser,null);
  x=await invoke('searchFaculty',ids.mmss,{}, {},{code:'NUKK'});
  assert.equal(x.body.peerSchedule.some(r=>r.assignment==='exchange'),true,'incoming exchange shown for account-free faculty');
  assert.equal(x.body.rows.find(r=>r._id===ids.nukk).unavailable,true,'outgoing duty unavailable for subsequent exchange');
  x=await invoke('revertChange',ids.third,{changeId:offlineExchange});assert.equal(x.statusCode,404);
  users.push({_id:ids.nukkUser,role:'teacher',shortCode:'NUKK',name:'Newly registered NUKK'});
  x=await invoke('mySchedule',ids.nukkUser);
  assert.equal(x.statusCode,200);assert.equal(x.body.rows.some(r=>r.assignment==='exchange'),true,'shortcode-based changes appear after signup');
  x=await invoke('revertChange',ids.nukkUser,{changeId:offlineExchange});assert.equal(x.statusCode,200,'future recipient can revert');
  // V5: no published duty and no registered account are also valid for giveaway.
  x=await invoke('searchFaculty',ids.mmss,{}, {},{code:'NNEW'});
  assert.equal(x.body.faculty,null);assert.equal(x.body.rows.length,0);
  x=await invoke('createChange',ids.mmss,{}, {kind:'transfer',sourceRecordId:ids.a,targetCode:'NNEW'});
  assert.equal(x.statusCode,201);assert.equal(x.body.recipientHasAccount,false);
  const offlineTransfer=x.body.changeId;
  x=await invoke('searchFaculty',ids.mmss,{}, {},{code:'NNEW'});
  assert.equal(x.body.peerSchedule.length,1);
  assert.equal(x.body.peerSchedule[0].assignment,'transfer');
  users.push({_id:ids.futureUser,role:'teacher',shortCode:'NNEW',name:'Newly registered NNEW'});
  x=await invoke('mySchedule',ids.futureUser);assert.equal(x.body.rows.length,1);
  assert.equal(x.body.rows[0].assignment,'transfer');
  x=await invoke('revertChange',ids.futureUser,{changeId:offlineTransfer});assert.equal(x.statusCode,200);
  x=await invoke('mySchedule',ids.mmss);assert.equal(x.body.rows[0].assignment,'official');
  x=await invoke('deleteSession',ids.mmss,{}, {confirm:'Fall 2026 Mid Term'});assert.equal(x.statusCode,200);assert.equal(x.body.deletedChanges,4);assert.equal(changes.length,0);
  console.log('PASS: registered/unregistered exchange and transfer, overlap warnings, future signup, revert permissions, duplicate protection and delete cascade.');
})().catch(e=>{console.error(e);process.exitCode=1});
