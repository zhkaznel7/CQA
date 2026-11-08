import {afterEach,expect,it,vi} from 'vitest'
import {flushPromises,mount} from '@vue/test-utils'
import {createMemoryHistory,createRouter} from 'vue-router'
import ConversationList from '../src/features/conversations/ConversationList.vue'
import EvaluationPanel from '../src/features/evaluations/EvaluationPanel.vue'
import {demoService} from './fixtures/evaluation.js'
let view
afterEach(()=>{view?.unmount();view=null;vi.unstubAllGlobals()})
const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}})
it('keeps organizer group_id in ordinary pagination requests',async()=>{
 const calls=[];vi.stubGlobal('fetch',vi.fn(async url=>{calls.push(url);return response({data:[],pagination:{total:0,totalPages:0}})}))
 const router=createRouter({history:createMemoryHistory(),routes:[{name:'conversations',path:'/dialogs',component:ConversationList}]})
 await router.push('/dialogs?group_id=CONTROL_TEST&page=2');view=mount(ConversationList,{global:{plugins:[router]}});await flushPromises()
 expect(new URL(calls[0],'http://localhost').searchParams.get('group_id')).toBe('CONTROL_TEST')
 expect(new URL(calls[0],'http://localhost').searchParams.get('page')).toBe('2')
})
it('keeps organizer group_id across every page of channel-alias filtering',async()=>{
 const calls=[];vi.stubGlobal('fetch',vi.fn(async url=>{calls.push(url);return response({data:[],pagination:{total:0,totalPages:2}})}))
 const router=createRouter({history:createMemoryHistory(),routes:[{name:'conversations',path:'/dialogs',component:ConversationList}]})
 await router.push('/dialogs?group_id=DEV&channel=voice&language=RU');view=mount(ConversationList,{global:{plugins:[router]}});await flushPromises()
 expect(calls).toHaveLength(2);for(const url of calls)expect(new URL(url,'http://localhost').searchParams.get('group_id')).toBe('DEV')
})
it('handles a preserved legacy score=null without rendering failure or invented score',async()=>{
 const result=await demoService.evaluate();result.evaluation=structuredClone(result.evaluation);result.evaluation.score=null;result.currentScore=null
 const evaluate=vi.fn(async()=>result);const errors=[]
 view=mount(EvaluationPanel,{props:{conversationId:'synthetic',service:{listVersions:demoService.listVersions,evaluate}},global:{config:{errorHandler:error=>errors.push(error.message)}}})
 await flushPromises();await view.findAll('button').find(b=>b.text()==='Оценить').trigger('click');await flushPromises()
 expect(errors).toEqual([]);expect(view.get('[role="alert"]').text()).toMatch(/формат|не.*рассчитан|нет.*балл/i)
 expect(view.text()).not.toContain('0 / 100');expect(evaluate).toHaveBeenCalledTimes(1);expect(result.evaluation.score).toBeNull()
})
it('applies a supplied organizer group, resets pagination and rejects an invalid identifier',async()=>{
 const calls=[];vi.stubGlobal('fetch',vi.fn(async url=>{calls.push(url);return response({data:[],pagination:{total:0,totalPages:0}})}))
 const router=createRouter({history:createMemoryHistory(),routes:[{name:'conversations',path:'/dialogs',component:ConversationList}]})
 await router.push('/dialogs?group_id=DEV&page=3&language=KZ');view=mount(ConversationList,{global:{plugins:[router]}});await flushPromises()
 await view.get('input[name="group_id"]').setValue('CONTROL_TEST');await view.get('form').trigger('submit');await flushPromises()
 expect(router.currentRoute.value.query).toEqual({group_id:'CONTROL_TEST',language:'KZ'})
 expect(new URL(calls.at(-1),'http://localhost').searchParams.get('group_id')).toBe('CONTROL_TEST')
 const before=calls.length;await view.get('input[name="group_id"]').setValue('../private?token=invalid');await view.get('form').trigger('submit');await flushPromises()
 expect(view.get('[role="alert"]').text()).toContain('group_id');expect(calls).toHaveLength(before);expect(router.currentRoute.value.query.group_id).toBe('CONTROL_TEST')
})
it('renders valid score.total=null as uncalculated, preserving N/A instead of inventing zero',async()=>{
 const result=await demoService.evaluate();result.evaluation=structuredClone(result.evaluation);result.evaluation.score.total=null;result.currentScore=result.evaluation.score
 view=mount(EvaluationPanel,{props:{conversationId:'synthetic',service:{listVersions:demoService.listVersions,evaluate:async()=>result}}})
 await flushPromises();await view.findAll('button').find(b=>b.text()==='Оценить').trigger('click');await flushPromises()
 expect(view.text()).toContain('не рассчитан');expect(view.text()).toContain('N/A');expect(view.find('[role="alert"]').exists()).toBe(false);expect(result.evaluation.score.total).toBeNull()
})
