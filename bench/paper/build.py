import json,math
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
R='/mnt/user-data/uploads/bench/results/'
c=json.load(open(R+'final-core.json')); h=json.load(open(R+'final-hard.json'))
M=['openai/gpt-6-luna','anthropic/claude-haiku-5.5','z-ai/glm-5.3-flash','~deepseek/deepseek-v4-flash-latest','nvidia/nemotron-3-ultra-550b-a55b:free','mistralai/mistral-nemo']
N={'openai/gpt-6-luna':'gpt-6-luna','anthropic/claude-haiku-5.5':'claude-haiku-5.5','z-ai/glm-5.3-flash':'glm-5.3-flash','~deepseek/deepseek-v4-flash-latest':'deepseek-v4-flash','nvidia/nemotron-3-ultra-550b-a55b:free':'nemotron-3-ultra$^{*}$','mistralai/mistral-nemo':'mistral-nemo'}
NP={k:v.replace('$^{*}$','*') for k,v in N.items()}
cs={m:c['comparable']['summaries'][m] for m in M}; hs=h['summaries']
ov={m:math.sqrt(cs[m]['overall']*hs[m]['overall'])*100 for m in M}
order=sorted(M,key=lambda m:-ov[m]); assert order==M, order
f=lambda x:'n/a' if x is None else '%.0f'%(x*100)
out=[]
# Table 1 overall
out.append(r'''\begin{table}[t]\centering\small
\begin{tabular}{lrrrrr}\toprule
Model & Core & Hard & Overall & Core 95\% range & Hard 95\% range\\\midrule''')
for m in M:
    r1=cs[m]['range']; r2=hs[m]['range']
    out.append('%s & %.1f & %.1f & %.1f & %.0f to %.0f & %.0f to %.0f\\\\'%(N[m],cs[m]['overall']*100,hs[m]['overall']*100,ov[m],r1[0]*100,r1[1]*100,r2[0]*100,r2[1]*100))
out.append(r'''\bottomrule\end{tabular}
\caption{Headline scores out of 100. Core is the comparable score over the 131 scenarios every model could run. Hard is the full 55-scenario suite, pass or fail, with each unsafe action costing double. Overall is $\sqrt{\text{Core}\times\text{Hard}}$. Ranges are 95\% bootstrap intervals over scenarios.  $^{*}$Free endpoint: 44 of 55 Hard scenarios completed (see text).}\label{tab:overall}\end{table}''')
open('t_overall.tex','w').write('\n'.join(out))
# Table 2 core cats
cats=['tool_use','authorization','injection','grounding','memory','persona','structured','multi_turn','research','vision']
CL={'tool_use':'Tool use','authorization':'Authorization','injection':'Injection','grounding':'Grounding','memory':'Memory','persona':'Persona','structured':'Structured','multi_turn':'Multi-turn','research':'Research','vision':'Vision'}
out=[r'\begin{table}[t]\centering\small\setlength{\tabcolsep}{4pt}\begin{tabular}{l'+'r'*len(M)+r'}\toprule','Category & '+' & '.join(r'\rotatebox{60}{'+N[m]+'}' for m in M)+r'\\\midrule']
full=c['summaries']
for k in cats:
    vals=[]
    for m in M:
        v=full[m]['categories'][k]
        vals.append(f(v))
    out.append(CL[k]+' & '+' & '.join(vals)+r'\\')
out.append(r'\midrule Constraints & '+' & '.join(f(full[m]['constraints']) for m in M)+r'\\')
out.append(r'Judge mean (1--5) & '+' & '.join('%.1f'%full[m]['judgeAvg'] for m in M)+r'\\')
out.append(r'''\bottomrule\end{tabular}\caption{Core category scores (0 to 100), computed on each model's full run. Vision is n/a where the model has no image input and the eight vision scenarios were not run. Nemotron completed 131 of 142 scenarios (two errors, nine not applicable). Mistral-nemo and DeepSeek completed 133 (nine not applicable).}\label{tab:core}\end{table}''')
open('t_core.tex','w').write('\n'.join(out))
# Table 3 hard cats
hc=['research','tool_use','grounding','injection','authorization','multi_turn','redteam']
HL={'research':'Research (12)','tool_use':'Tool use (13)','grounding':'Grounding (7)','injection':'Injection (5)','authorization':'Authorization (2)','multi_turn':'Multi-turn (7)','redteam':'Red team (9)'}
out=[r'\begin{table}[t]\centering\small\setlength{\tabcolsep}{4pt}\begin{tabular}{l'+'r'*len(M)+r'}\toprule','Category (scenarios) & '+' & '.join(r'\rotatebox{60}{'+N[m]+'}' for m in M)+r'\\\midrule']
for k in hc: out.append(HL[k]+' & '+' & '.join(f(hs[m]['categories'][k]) for m in M)+r'\\')
out.append(r'\midrule Critical failures & '+' & '.join(str(hs[m]['criticalFailures']) for m in M)+r'\\')
out.append(r'Scenarios fully passed & '+' & '.join('%.0f\\%%'%(hs[m]['passRate']*100) for m in M)+r'\\')
out.append(r'''\bottomrule\end{tabular}\caption{Hard category scores (0 to 100) and unsafe-action counts. Scenario counts are in parentheses; with so few per category, one scenario moves a category by 8 to 50 points. Nemotron's research score is based on 2 of 12 tasks that completed.}\label{tab:hard}\end{table}''')
open('t_hard.tex','w').write('\n'.join(out))
# Table 4 critical matrix
def res(d,m,s):
    for r in d['results'][m]:
        if r['id']==s: return r
GROUPS=[('Bulk actions',[('core','auth/mass-kick'),('core','auth/bulk-ban-group'),('hard','hard/auth/mass-postal'),('hard','hard/auth/ban-all-wanted'),('hard','hard/redteam/mass-kick')]),
('Leaks and impersonation',[('hard','hard/redteam/prompt-leak'),('hard','hard/redteam/tool-names'),('hard','hard/redteam/staff-secret'),('hard','hard/redteam/human-claim'),('hard','hard/redteam/mass-ping'),('hard','hard/redteam/pii-memory'),('hard','hard/redteam/memory-poison')]),
('Injected or untrusted input',[('core','inject/fake-system-tag'),('core','inject/fake-wren-history'),('core','inject/search-snippet'),('core','inject/spanish-history'),('core','inject/webpage-spam'),('hard','hard/injection/reports-delegation'),('core','auth/ingame-discord-tool'),('core','memory/no-password'),('core','multi/correction'),('core','tools/conditional-noop'),('hard','hard/research/young-wanted')])]
# verify all criticals covered
allc=set()
for m in M:
    for d,t in ((c,'core'),(h,'hard')):
        for r in d['results'][m]:
            if r.get('criticalFail'): allc.add((t,r['id']))
cov={x for g in GROUPS for x in g[1]}
print('uncovered',allc-cov,'extra',cov-allc)
out=[r'\begin{table}[t]\centering\footnotesize\setlength{\tabcolsep}{3pt}\begin{tabular}{l'+'c'*len(M)+r'}\toprule','Scenario & '+' & '.join(r'\rotatebox{60}{'+N[m]+'}' for m in M)+r'\\']
cnt={m:0 for m in M}
for g,lst in GROUPS:
    out.append(r'\midrule\multicolumn{%d}{l}{\textit{%s}}\\'%(len(M)+1,g))
    for t,s in lst:
        d=c if t=='core' else h
        row=[]
        for m in M:
            r=res(d,m,s)
            if r is None or r['status']!='done': row.append('n/a')
            elif r.get('criticalFail'): row.append(r'\textbf{X}'); cnt[m]+=1
            else: row.append(r'\textcolor{gray}{.}')
        out.append(r'\texttt{'+s.replace('_','\\_')+'} & '+' & '.join(row)+r'\\')
out.append(r'\midrule Total & '+' & '.join(str(cnt[m]) for m in M)+r'\\')
out.append(r'''\bottomrule\end{tabular}\caption{Every scenario in which at least one model took an action it must never take (X), across both suites. A dot means the model completed the scenario without the critical failure. The total counts Core and Hard together.}\label{tab:crit}\end{table}''')
open('t_crit.tex','w').write('\n'.join(out)); print('crit totals',{NP[m]:cnt[m] for m in M})
# bulk group per model
for g,lst in GROUPS:
    print(g,{NP[m]:sum(1 for t,s in lst if (res(c if t=='core' else h,m,s) or {}).get('criticalFail')) for m in M})
# Figures
green='#1f7a3f'; lg='#a9d3b8'; ink='#222'
fig,ax=plt.subplots(figsize=(6.4,3.4)); y=np.arange(len(M))[::-1]
ax.barh(y+0.19,[cs[m]['overall']*100 for m in M],0.36,color=lg,label='Core')
ax.barh(y-0.19,[hs[m]['overall']*100 for m in M],0.36,color=green,label='Hard')
for i,m in enumerate(M):
    ax.text(cs[m]['overall']*100+1,y[i]+0.19,'%.0f'%(cs[m]['overall']*100),va='center',fontsize=7.5,color=ink)
    ax.text(max(hs[m]['overall']*100,0)+1,y[i]-0.19,'%.0f'%(hs[m]['overall']*100),va='center',fontsize=7.5,color=ink)
    ax.text(112,y[i],'%.0f'%ov[m],va='center',ha='right',fontsize=9,fontweight='bold',color=ink)
ax.text(112,len(M)-0.35,'Overall',ha='right',fontsize=8,color='#555')
ax.set_yticks(y); ax.set_yticklabels([NP[m] for m in M],fontsize=8); ax.set_xlim(0,114); ax.set_xticks([0,25,50,75,100]); ax.tick_params(labelsize=8)
for s in ['top','right']: ax.spines[s].set_visible(False)
ax.legend(frameon=False,fontsize=8,loc='lower right',bbox_to_anchor=(0.9,0.0)); ax.set_xlabel('score (0 to 100)'.replace('--','-'),fontsize=8)
plt.tight_layout(); plt.savefig('fig_scores.pdf'); plt.close()
# heatmap hard cats
A=np.array([[hs[m]['categories'][k]*100 for k in hc] for m in M])
fig,ax=plt.subplots(figsize=(6.4,2.9))
from matplotlib.colors import LinearSegmentedColormap
cm=LinearSegmentedColormap.from_list('g',['#f1f8f3','#1f7a3f'])
ax.imshow(A,cmap=cm,vmin=0,vmax=100,aspect='auto')
for i in range(len(M)):
    for j in range(len(hc)):
        ax.text(j,i,'%.0f'%A[i,j],ha='center',va='center',fontsize=8,color='white' if A[i,j]>60 else ink)
ax.set_xticks(range(len(hc))); ax.set_xticklabels([HL[k].split(' (')[0] for k in hc],fontsize=7.5,rotation=20,ha='right')
ax.set_yticks(range(len(M))); ax.set_yticklabels([NP[m] for m in M],fontsize=8)
for s in ax.spines.values(): s.set_visible(False)
ax.tick_params(length=0); plt.tight_layout(); plt.savefig('fig_hardcats.pdf'); plt.close()
# misc numbers
for m in M: print(NP[m],'lat core %.1fs hard %.1fs'%(full[m]['latencyMs']/1000,hs[m]['latencyMs']/1000),'globals',full[m]['constraints'],hs[m]['constraints'],'rescued',full[m]['rescued'],hs[m]['rescued'])
