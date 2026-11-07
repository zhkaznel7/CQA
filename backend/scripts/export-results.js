import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,open,link,unlink} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {prisma} from '../src/database/client.js';
import {organizerRecords} from '../src/modules/conversations/organizer-payload.js';
import {createOfficialResults,mockModel} from '../src/modules/exports/official-results.js';
import {createAiExportInputs} from '../src/modules/exports/ai-inputs.js';

try{
  const {values}=parseArgs({options:{dataset:{type:'string'},input:{type:'string'},checklist:{type:'string'},team:{type:'string'},output:{type:'string'},'model-name':{type:'string'},'model-mode':{type:'string'},'allow-mock':{type:'boolean',default:false},'ai-input-dir':{type:'string'}}});
  if(!['dev','prod'].includes(values.dataset)||!values.input||!values.checklist||!values.team?.trim())throw new Error('Required: --dataset dev|prod --input FILE --checklist UUID --team NAME');
  const manifest=organizerRecords(JSON.parse(await readFile(values.input,'utf8')),500);
  const model=values['allow-mock']?mockModel:{name:values['model-name'],mode:values['model-mode']};
  if(values['allow-mock']&&(values['model-name']||values['model-mode']))throw new Error('Synthetic mock metadata cannot be relabelled as another model');
  if(!values['allow-mock']&&(!model.name?.trim()||!['local','external_api','hybrid'].includes(model.mode)))throw new Error('Declare the actually used --model-name and --model-mode; they cannot be inferred from HTTP');
  const {file,transfer}=await prisma.$transaction(async tx=>{
    const checklist=await tx.checklist.findUniqueOrThrow({where:{id:values.checklist},include:{criteria:true}});
    const evaluations=await tx.evaluation.findMany({where:{checklistId:checklist.id,conversation:{externalId:{in:manifest.map(r=>r.externalId)}}},
      include:{conversation:true,results:{include:{criterion:{select:{key:true}}}}}});
    const confirmations=await tx.applicabilityConfirmation.findMany({where:{checklistId:checklist.id,conversationId:{in:evaluations.map(e=>e.conversationId)}}});
    const file=createOfficialResults({teamName:values.team,model,manifest,evaluations,checklist,expectedCount:values.dataset==='dev'?65:10,allowMock:values['allow-mock'],dataset:values.dataset,confirmations});
    return {file,transfer:values['ai-input-dir']?createAiExportInputs({file,evaluations,checklist,dataset:values.dataset}):null};
  },{isolationLevel:'RepeatableRead',timeout:30000});
  const backendRoot=fileURLToPath(new URL('../',import.meta.url));
  const root=existsSync(resolve(backendRoot,'../backend/package.json'))?resolve(backendRoot,'..'):backendRoot;
  const target=resolve(values.output??(values['allow-mock']?resolve(backendRoot,'.tmp/exports/'+values.dataset+'.mock.json'):resolve(root,'results/'+values.dataset+'/results.json')));
  const inside=directory=>{const path=relative(resolve(root,directory),target);return path&&!path.startsWith('..')&&!isAbsolute(path);};
  if(!inside('results')&&!inside(resolve(backendRoot,'.tmp')))throw new Error('Output must be inside results/ or backend/.tmp/');
  if(values['allow-mock']&&[resolve(root,'results/dev/results.json'),resolve(root,'results/prod/results.json')].some(path=>path.toLowerCase()===target.toLowerCase()))throw new Error('Synthetic mock results cannot occupy official submission paths');
  let transferDir;
  if(transfer){
    transferDir=resolve(values['ai-input-dir']);const path=relative(resolve(backendRoot,'.tmp'),transferDir);
    if(!path||path.startsWith('..')||isAbsolute(path))throw new Error('AI input directory must be a new directory inside backend/.tmp');
    await mkdir(transferDir);
  }
  await mkdir(dirname(target),{recursive:true});
  const temporary=target+'.'+randomUUID()+'.tmp';let handle;
  try{handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(file,null,2)+'\n','utf8');await handle.sync();await handle.close();handle=undefined;await link(temporary,target);}
  finally{await handle?.close();await unlink(temporary).catch(()=>{});}
  if(transfer)for(const [name,value] of [['responses.json',transfer.responses],['backend-scores.json',transfer.scores],['manifest.json',transfer.manifest]])await writeFile(resolve(transferDir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({schema_version:file.schema_version,records:file.results.length,ok:file.results.filter(r=>r.status==='ok').length,error:file.results.filter(r=>r.status==='error').length,synthetic:values['allow-mock']}));
}catch(error){console.error(error.code==='EEXIST'?'Export file exists; nothing was overwritten.':'Export failed. Check dataset, model declaration, selected checklist and output format.');process.exitCode=1;}
finally{await prisma.$disconnect();}
