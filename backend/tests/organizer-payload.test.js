import assert from 'node:assert/strict';
import test from 'node:test';
import {createConversationSource} from '../src/modules/conversations/organizer-client.js';
import {organizerRecords} from '../src/modules/conversations/organizer-payload.js';

const source={conversation_id:'source-001',channel:'voice call',language:'RU',audio_url:null,
 transcript:[{timestamp:'2026-01-01T10:00:00.1234567+06:00',speaker:'operator',text:'Synthetic reply'}]};
const payload=records=>({error:'',isSuccess:true,data:{dataset_group_id:'DEV',total_records:records.length,records}});
test('official organizer envelope maps IDs/audio and keeps original transcript/channel',async()=>{
 const before=structuredClone(source);
 const records=await createConversationSource({IMPORT_SOURCE:'organizers',ORGANIZER_API_URL:'https://organizer.invalid/',IMPORT_MAX_RECORDS:500,IMPORT_MAX_BYTES:10000,IMPORT_TIMEOUT_MS:1000},async()=>Response.json(payload([source])))();
 assert.deepEqual(records,[{externalId:source.conversation_id,channel:source.channel,language:source.language,audioUrl:null,transcript:source.transcript}]);
 assert.deepEqual(source,before);
});
test('official DEV/PROD-shaped synthetic batches retain all 65/10 original IDs and languages',()=>{
 for(const size of [65,10]){const records=Array.from({length:size},(_,i)=>({...source,conversation_id:'synthetic-'+i,language:['RU','KZ','EN'][i%3]}));
  assert.deepEqual(organizerRecords(payload(records)).map(r=>r.externalId),records.map(r=>r.conversation_id));}
});
test('upstream failure, truncated dataset and limits cannot become empty success',()=>{
 for(const input of [null,{}, {isSuccess:false,data:{records:[]}}, {...payload([source]),data:{total_records:2,records:[source]}},payload([source,source])]){
  assert.throws(()=>organizerRecords(input,1),e=>e.code==='UPSTREAM_INVALID_DATA');}
});
test('legacy conversations envelope and empty successful source remain supported',()=>{
 const record={externalId:'old',transcript:[]};assert.deepEqual(organizerRecords({conversations:[record]}),[record]);assert.deepEqual(organizerRecords(payload([])),[]);
});
