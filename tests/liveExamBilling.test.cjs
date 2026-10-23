const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../src/controllers/calculationController.js');
const SID = '1'.repeat(24), UID = '2'.repeat(24);
const same = (id) => String(id) === SID;
let saved = null, rows = [];
let rates = { dayDutyRate:100, eveningDutyRate:500, taxRate:10 };
const rq = data => ({ select(){return this;}, lean(){return Promise.resolve(data);}, then(a,b){return Promise.resolve(data).then(a,b);} });
const session={_id:SID,season:'Fall',year:2026,examType:'Mid Term',name:'Test exam'};
const models={
  '../models/FacultyDutyCalculation': {
    findOne:q=>rq(saved && q.teacher===UID && q.semester===saved.semester && q.examType===saved.examType ? saved : null),
    create:async obj=>{saved={...obj,_id:'3'.repeat(24),status:'pending'};return saved;},
  },
  '../models/FacultyCalculationSettings':{findOne:q=>rq(q.teacher===UID?rates:null)},
  '../models/ExamDutySession':{findById:id=>rq(same(id)?session:null)},
  '../models/User':{findOne:q=>rq(q._id===UID?{_id:UID,shortCode:'MMSS',name:'Teacher MMSS'}:null)},
  './examDutyController':{getFacultyDutyRows:async()=>rows},
  '../utils/examDutyBilling':require('../src/utils/examDutyBilling'),
  mongoose:{isValidObjectId:id=>same(id)},
};
const ctrl={};const context={module:{exports:ctrl},exports:ctrl,console,Date,require:module=>models[module] || (module==='mongoose'?models.mongoose:undefined)};
vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});
const res=()=>({statusCode:200,status(c){this.statusCode=c;return this;},json(o){this.body=o;return this;}});
const run=async(method,body)=>{const result=res();await context.module.exports[method]({user:{userId:UID},params:{sessionId:SID},body:body||{}},result);return result;};
const make=(id,date,startTime,assignment,category='exam')=>({
  _id:String(id).repeat(24),date,day:'',startTime,endTime:'8:30 PM', time:`${startTime}–8:30 PM`,assignment,category,
  program:'B.Sc. in CSE',intake:'54',section:'1',course:'CSE 101',room:`27${id}5`,invigilators:'MMSS',courseTeacher:'JFM',
  changeSide:assignment==='exchange'?'incoming':assignment==='transferred_out'?'outgoing':undefined, conflicts:[],
});
(async()=>{
  rows=[
    make(4,'2026-10-24','12:00 PM','official'), // Sat evening
    make(5,'2026-10-25','12:00 PM','official'), // Sun day
    make(6,'2026-10-25','7:00 PM','official'), // Sun evening
    make(7,'2026-10-26','10:00 AM','proxy'), // proxy day
    make(8,'2026-10-27','3:00 PM','exchange'), // incoming day
    make(9,'2026-10-29','10:00 AM','transferred_out'), // outgoing ignored
    make('a','2026-10-30','10:00 AM','official','reserved'), // Friday reserved evening
  ];
  let response=await run('previewExamDutyBill');
  assert.equal(response.statusCode,200);
  assert.equal(response.body.activeCount,6);
  assert.equal(response.body.outgoingCount,1);
  assert.equal(response.body.proxyCount,1);
  assert.equal(response.body.incomingCount,1);
  assert.equal(response.body.reservedCount,1);
  assert.equal(response.body.billing.dayDuties,3);
  assert.equal(response.body.billing.eveningDuties,3);
  assert.equal(response.body.billing.gross,1800);
  assert.equal(response.body.billing.taxAmount,180);
  assert.equal(response.body.billing.total,1620);
  assert.equal(response.body.duties.length,6);
  response=await run('syncExamDutyBill');
  assert.equal(response.statusCode,200);
  assert.equal(saved.sourceType,'exam_duties');
  assert.equal(saved.duties.length,6);
  assert.equal(saved.duties.filter(d=>d.dutyType==='evening').length,3);
  rows.push(make('b','2026-10-26','5:30 PM','official'));
  response=await run('previewExamDutyBill');
  assert.equal(response.body.reviewCount,1);
  assert.equal(response.body.billing.total,1620,'ambiguous duty is not billed');
  response=await run('syncExamDutyBill');
  assert.equal(response.statusCode,422,'saving unresolved times forbidden');
  rows.pop();
  saved.status='received';
  response=await run('syncExamDutyBill');
  assert.equal(response.statusCode,409,'received billing snapshots cannot be rewritten');
  assert.equal(response.body.code,'RECEIVED_BILL_LOCKED');
  saved.status='pending';saved.sourceType='manual';saved.sourceSession=null;
  response=await run('syncExamDutyBill');
  assert.equal(response.statusCode,409,'manual pending bills require confirmation');
  assert.equal(response.body.code,'MANUAL_BILL_EXISTS');
  saved.save=async function(){return this;};
  response=await run('syncExamDutyBill',{replaceManual:true});
  assert.equal(response.statusCode,200);
  assert.equal(saved.sourceType,'exam_duties');
  console.log('PASS: live billing weekend, weekday, proxy, exchange, transfer-out, reserved, tax, review protection and manual/received bill safety');
})().catch(error=>{console.error(error);process.exitCode=1;});
