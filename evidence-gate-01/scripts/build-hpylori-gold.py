#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-hpylori-gold.mjs (python) — builds PROVISIONAL Semantic Gold for
case-hpylori-treatment. FROZEN semantics:
  - labels decided by reading the full corpus (216 sources) BEFORE any
    selector result exists (2026-08-28, gate-01 preregistration order)
  - gold_version = g2-gate01-provisional-hpylori (PROVISIONAL; second
    adjudication packet covers decision-sensitive labels)
  - every referenced source_id is verified against the frozen corpus
  - relevance gate: only relevant sources may appear in scored families
"""
import json, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(BASE, 'corpus')
QIDS = ['52215270', '533032588', '616791818', '3376603186', '525603218']

pool = {}
for qid in QIDS:
    j = json.load(open(os.path.join(CORPUS, qid, 'answers.json'), encoding='utf-8'))
    for a in j['answers']:
        sid = f"{qid}:{a['id']}"
        # normalized text length (match harness normalizeText approx: strip tags + collapsed; use raw content length as proxy)
        import re
        text = re.sub(r'<[^>]+>', ' ', a.get('content') or '')
        text = re.sub(r'\s+', '', text)
        pool[sid] = {
            'qid': qid,
            'author': a.get('author'),
            'vote': a.get('voteupCount') or 0,
            'chars': len(text),
            'createdTime': a.get('createdTime'),
            'links': len(a.get('assets', {}).get('links', []) or []),
            'refs': len(a.get('assets', {}).get('references', []) or []),
        }
print('pool size:', len(pool))

def check(sids, fam):
    missing = [s for s in sids if s not in pool]
    if missing:
        print(f'FATAL {fam} missing:', missing)
        sys.exit(1)

# ---------------------------------------------------------------------------
# 1. RELEVANCE — on-topic gate. Empty content (chars==0) and non-substantive
#    noise (nonsense / off-topic consultation) are NOT relevant. Everything
#    topically about Hp treatment/risk is relevant (even promotional answers).
# ---------------------------------------------------------------------------
irrelevant = [
    # chars==0 or nonsense
    '52215270:2696559268', '52215270:2418306805', '52215270:1970899658', '52215270:2087666225',
    '52215270:2305924593', '52215270:22612538877', '52215270:3094043597', '52215270:2264079628',
    '52215270:2715174455', '52215270:2401898552', '52215270:1976706566', '52215270:1973153394',
    '52215270:2250230136', '52215270:2121869912',
    '533032588:3273842009', '533032588:2503917355', '533032588:2500795192',
    '616791818:3547893842', '616791818:3240224427', '616791818:3223578860', '616791818:3550920453',
    '3376603186:36966967268',
    '525603218:3272847370',
    # off-topic / nonsense
    '52215270:983652016',  # unrelated GI consultation about bowels
    '52215270:1884103486',  # nonsense "！ne 我 @知乎视频"
    '52215270:2442247558',  # "答案就一个字：治！" (meta, no content)
    '52215270:161497792',  # bare consultation question (no content)
    '52215270:2595133035',  # contains substantive personal data -> keep relevant (see below)
]
# remove the last one (keep as relevant)
irrelevant.remove('52215270:2595133035')
relevant = [s for s in pool if s not in set(irrelevant)]
check(relevant, 'relevance')
check(irrelevant, 'irrelevant')
print('relevant:', len(relevant), '/', len(pool))

# ---------------------------------------------------------------------------
# 2. MUST_SEE — decision-critical, high-information sources (relevance-gated).
# ---------------------------------------------------------------------------
must_see = [
    # Q1 (52215270): the treatment decision
    '52215270:1829396577',  # 孙小白: quantified 10y risk/benefit analysis w/ references
    '52215270:1909462572',  # 逍遥散人: systematic treatment-indication explainer (9 refs)
    '52215270:2326510132',  # 四川大学华西医院: authoritative institutional indications
    '52215270:975101683',   # 魏玮: expert-consensus disagreement analysis (gut-level)
    '52215270:1466037599',  # 阿泰在日本: asymptomatic + normal scope may defer; intl vs CN consensus
    '52215270:3312209969',  # 真实姓名: harm case (IBS after quad therapy) — opposite side
    '52215270:2297169997',  # 药理学博士: indication list + 7 bismuth-quad regimens
    '52215270:3156697298',  # 超医生: 6th National Consensus indications
    '52215270:2874637547',  # 石家庄健胃中医院: two-school debate + 2019 Shanghai consensus
    '52215270:2240620369',  # 尘埃中的哲学圣人: points to the authoritative 5th consensus text
    '52215270:3611600579',  # 余白: severe side-effect case (anxiety relapse) — minority signal
    '52215270:2071906039922963690',  # 方糖医生: 2026 CN guideline — treat unless countervailing
    '52215270:1515402768',  # 老谢: no-symptom may defer + 成虹(北医一院) authority + probiotics research
    # Q2 (533032588): gastric cancer evidence
    '533032588:83325887262',  # 无心无得: detailed gastric-cancer mechanism review (paper-level)
    '533032588:2712153634',  # 海云舟: Lancet-Public Health 512k cohort data
    '533032588:2488047450',  # 健康之初: eradicate unless countervailing (guideline reading)
    # Q3 (616791818): real-world post-eradication outcome
    '616791818:3164788252',  # 追逐玉米地: two-round eradication beneficiary (28-day patient log)
    '616791818:3257696322',  # 徐致国: conditional pathogen viewpoint + personal recommendation
    '616791818:105981792797',  # 伯伯: research note — intestinal metaplasia may persist (epigenetic)
    '616791818:91125298017',  # 无心无得: DDR/senescence paper walkthrough (root-gene effect)
    # Q4 (3376603186): self-cure question
    '3376603186:28820202588',  # 凡尘: spontaneous cure probability low; quad recommended
    # Q5 (525603218): non-treatment harm
    '525603218:2444858135',  # 无幽小卫士: 2019 expert consensus — adults test & treat
]
check(must_see, 'must_see')
must_see = [s for s in must_see if s in set(relevant)]
print('must_see:', len(must_see))

# ---------------------------------------------------------------------------
# 3. ASPECT MEMBERSHIP (critical aspects; primary_sources = main supporting
#    sources per aspect; cross-question where natural)
# ---------------------------------------------------------------------------
aspects = {
    'case-hpylori-treatment:asp-treatment-decision': [
        '52215270:1829396577', '52215270:1909462572', '52215270:2326510132', '52215270:975101683',
        '52215270:1466037599', '52215270:2297169997', '52215270:3156697298', '52215270:2874637547',
        '52215270:2240620369', '52215270:2071906039922963690', '52215270:2275231958', '52215270:2038115913',
        '533032588:2488047450', '533032588:3093723438', '616791818:3257696322', '525603218:2444858135',
        '3376603186:28820202588',
    ],
    'case-hpylori-treatment:asp-gastric-cancer-risk': [
        '52215270:1809284916', '52215270:2272668883', '52215270:1829396577', '52215270:1258969204',
        '533032588:2508198156', '533032588:83325887262', '533032588:2712153634', '533032588:2489066226',
        '533032588:2502378700', '533032588:2487979366', '616791818:1955368980899402784', '525603218:2440646193',
        '525603218:2427116849',
    ],
    'case-hpylori-treatment:asp-treatment-regimens': [
        '52215270:1497463304', '52215270:1876563261', '52215270:52521318572', '52215270:2297169997',
        '52215270:3156697298', '52215270:1997026005', '52215270:2301944878',
        '533032588:2488047450', '533032588:2487596117', '533032588:2491991837',
        '616791818:1987191518713361343', '616791818:1981386432158393643', '3376603186:25401570453',
        '3376603186:25292976115',
    ],
    'case-hpylori-treatment:asp-side-effects-tradeoff': [
        '52215270:3312209969', '52215270:3611600579', '52215270:2789431170', '52215270:1795081592',
        '52215270:2275231958', '52215270:2301329431', '52215270:2595133035', '52215270:2580378256',
        '616791818:3255762253', '616791818:3162664036', '3376603186:1981743613626052804',
    ],
    'case-hpylori-treatment:asp-self-cure-and-alternatives': [
        '52215270:1515402768', '52215270:2347348694', '52215270:3031497806', '52215270:2472924515',
        '52215270:1627205318', '52215270:2101399316', '52215270:2238726920', '52215270:2529421586',
        '533032588:2487592822', '616791818:3161426337', '616791818:97789919107',
        '3376603186:28820202588', '3376603186:25292976115', '3376603186:26252898137',
    ],
    'case-hpylori-treatment:asp-infection-transmission': [
        '52215270:1546721934', '52215270:2312111925', '52215270:2051757753643823511', '52215270:2632347383',
        '52215270:2284692777', '52215270:2299730827', '52215270:2356366405', '52215270:2310008353',
        '616791818:3499189140', '616791818:3163363123', '525603218:2451056296',
    ],
    'case-hpylori-treatment:asp-real-world-experience': [
        '616791818:3164788252', '616791818:3257696322', '616791818:101231285159', '52215270:1751794385',
        '52215270:1308415055', '52215270:1473588196', '52215270:2273390916', '52215270:1852800531',
        '52215270:1645335552', '52215270:2426256101', '616791818:1981386432158393643',
        '616791818:1987191518713361343',
    ],
}
# dedupe + relevance gate + check
for k in aspects:
    lst = sorted(set(aspects[k]))
    check(lst, f'aspect {k}')
    aspects[k] = [s for s in lst if s in set(relevant)]
    print('aspect', k, len(aspects[k]))

aspect_list = [{'aspect_id': k, 'name': k, 'primary_sources': v, 'disputed': False} for k, v in aspects.items()]

# ---------------------------------------------------------------------------
# 4. EXPERTISE_TOPIC_MATCH (supported = credentialed medical authors/institutions
#    with substantive topic content; everything else UNRESOLVED/excluded)
# ---------------------------------------------------------------------------
expert_supported = [
    '52215270:2326510132', '52215270:975101683', '52215270:1876563261', '52215270:2042267633',
    '52215270:1497463304', '52215270:2296865871', '52215270:1785021055', '52215270:2275231958',
    '52215270:2297169997', '52215270:3156697298', '52215270:2071906039922963690', '52215270:2038115913',
    '52215270:2874637547', '52215270:3334474801', '52215270:2569715050', '52215270:2288209391',
    '52215270:2368983902', '52215270:2356366405', '52215270:1515402768',
    '533032588:1949471360410695335', '533032588:2488547871', '533032588:3273842009',
    '616791818:3255762253', '616791818:3499189140', '616791818:3220465136',
    '3376603186:25401570453',
    '525603218:2439553978', '525603218:2427116849',
]
# 3273842009 is chars=0/irrelevant — remove
expert_supported = [s for s in expert_supported if s in set(relevant)]
check(expert_supported, 'expert')
print('expert supported:', len(expert_supported))

# ---------------------------------------------------------------------------
# 5. EVIDENCE_QUALITY (sources whose content carries real evidence: guidelines,
#    consensus, papers, cohort data, references)
# ---------------------------------------------------------------------------
evidence_quality = [
    '52215270:1829396577', '52215270:1909462572', '52215270:2326510132', '52215270:975101683',
    '52215270:1497463304', '52215270:2297169997', '52215270:3156697298', '52215270:2240620369',
    '52215270:2071906039922963690', '52215270:2874637547', '52215270:2580378256', '52215270:2042267633',
    '52215270:2284692777', '52215270:1809284916', '52215270:2272668883', '52215270:1515402768',
    '52215270:2051757753643823511', '52215270:2368983902',
    '533032588:2508198156', '533032588:83325887262', '533032588:2712153634', '533032588:2488047450',
    '533032588:2488547871', '533032588:2490038697', '533032588:2502378700', '533032588:2700138473',
    '616791818:91125298017', '616791818:105981792797', '616791818:1955368980899402784',
    '3376603186:28820202588', '3376603186:25292976115', '3376603186:25401570453',
    '525603218:2444858135', '525603218:2427116849',
]
check(evidence_quality, 'evidence_quality')
evidence_quality = [s for s in evidence_quality if s in set(relevant)]
print('evidence_quality:', len(evidence_quality))

# ---------------------------------------------------------------------------
# 6. UNIQUE_LONG_TAIL_CONTRIBUTION (low-vote but genuinely distinct value)
# ---------------------------------------------------------------------------
long_tail = [
    '52215270:1833916290',  # evolution/commensal-protection perspective
    '52215270:1466037599',  # asymptomatic-defer position (also must-see; keep in long tail as distinct stance)
    '52215270:1627205318',  # TCM-advantage perspective
    '52215270:1333451074',  # treat only if stomach disease
    '52215270:2308683120',  # short: treat not mandatory but advisable
    '52215270:2347348694',  # probiotics negative result case
    '52215270:3031497806',  # no-quad eradication claim
    '52215270:2472924515',  # TCM success case
    '52215270:2529421586',  # pharmacy view: consult doctor, no self-medication
    '52215270:2300294213',  # countervailing factors detailed
    '52215270:1850517467',  # life-stage trade-off view
    '52215270:1988509248930456248',  # atrophic gastritis association note
    '52215270:2776566' if False else '52215270:2723267423',  # low-risk strain observation approach
    '533032588:2487612695',  # bacteria history explainer
    '533032588:3137416885',  # Ötzi/history fun-fact (unique context)
    '533032588:2488282061',  # first-round resistance warning
    '533032588:2502760023',  # Hp != gastric cancer nuance
    '533032588:2488625187',  # skeptical "cannot eradicate in China"
    '533032588:2487592822',  # TCM approach success
    '616791818:3161531379',  # complementary nutrition view on reflux
    '616791818:3161562744',  # Hp gone != stomach fine (multi-cause)
    '616791818:3163363123',  # oral cavity as source
    '616791818:3161426337',  # probiotics negative case (mom)
    '616791818:3161812328',  # avoid-medicalization view
    '616791818:3162664036',  # reflux causality uncertainty
    '616791818:1984271783860406148',  # eradication does not cause reflux (counter to above)
    '3376603186:26252898137',  # no self-cure; reinfection reality
    '3376603186:1983205076735648039',  # satirical self-cure logic
    '525603218:2428893642',  # conditional-pathogen / acid-balance view
    '525603218:2420657338',  # guideline reality check
    '525603218:2440646193',  # primary prevention stance
]
long_tail = sorted(set(long_tail))
check(long_tail, 'long_tail')
long_tail = [s for s in long_tail if s in set(relevant)]
print('long_tail:', len(long_tail))

# ---------------------------------------------------------------------------
# 7. CONTRADICTION claim clusters (claim_stances only; no provenance-derived
#    stances)
# ---------------------------------------------------------------------------
contradiction_clusters = [
    {
        'claim_id': 'case-hpylori-treatment:c1-asymptomatic-must-treat',
        'claim': '成人 Hp 阳性即使无症状，也应根除治疗（无抗衡因素即治）',
        'disputed': False,
        'stances': {
            'for': [
                '52215270:1876563261', '52215270:1853290758', '52215270:2071906039922963690',
                '52215270:2300294213', '533032588:2488047450', '533032588:3093723438',
                '52215270:2569715050',
            ],
            'against': [
                '52215270:975101683', '52215270:1466037599', '52215270:1627205318',
                '52215270:1515402768', '52215270:2275231958', '52215270:1333451074',
                '52215270:2238726920',
            ],
        },
    },
    {
        'claim_id': 'case-hpylori-treatment:c2-hp-gastric-cancer-certainty',
        'claim': 'Hp 是明确致癌物/应高度重视 vs 风险被夸大/条件致病不必恐慌',
        'disputed': False,
        'stances': {
            'for': [
                '52215270:1546721934', '52215270:2272668883', '52215270:1809284916',
                '52215270:1853290758', '533032588:2487596117', '525603218:2439553978',
            ],
            'against': [
                '52215270:1833916290', '52215270:1850517467', '533032588:2488625187',
                '533032588:2492376769', '525603218:2428893642', '533032588:2489103782',
            ],
        },
    },
    {
        'claim_id': 'case-hpylori-treatment:c3-side-effects-vs-benefit',
        'claim': '四联治疗副作用/菌群破坏值得担忧 vs 副作用可控、根除利大于弊',
        'disputed': False,
        'stances': {
            'for': [
                '52215270:3312209969', '52215270:3611600579', '52215270:1795081592',
                '52215270:2789431170', '52215270:2595133035', '616791818:3255762253',
            ],
            'against': [
                '52215270:2312503952', '52215270:2368754859', '52215270:1473588196',
                '52215270:2273390916', '616791818:3164788252', '52215270:1927817876',
            ],
        },
    },
    {
        'claim_id': 'case-hpylori-treatment:c4-self-cure-reality',
        'claim': '不吃四联/益生菌/中药可自愈或清除 vs Hp 基本不能自愈、替代方案无证据',
        'disputed': False,
        'stances': {
            'for': [
                '52215270:2347348694', '52215270:3031497806', '52215270:2472924515',
                '52215270:2238726920', '533032588:2487592822', '616791818:3161426337',
                '3376603186:28820202588',
            ],
            'against': [
                '52215270:2529421586', '52215270:3041977917', '3376603186:25401570453',
                '3376603186:26252898137', '3376603186:1983205076735648039', '3376603186:1986353979421123733',
            ],
        },
    },
]
all_cluster_sources = []
for c in contradiction_clusters:
    for stance in c['stances'].values():
        check(stance, c['claim_id'])
        all_cluster_sources.extend(stance)
# relevance gate on cluster sources (keep stance lists, but gold-stats should exclude irrelevant from scoring paths only as unresolved; contradiction family has no unresolved in pilot — leave as-is but all must be relevant)
bad = [s for s in all_cluster_sources if s not in set(relevant)]
if bad:
    print('FATAL contradiction refs not relevant:', bad)
    sys.exit(1)

# ---------------------------------------------------------------------------
# 8. REQUIRED_PROVENANCE_GROUPS (cross-question claims; covered only when EVERY
#    group has >=1 selected source)
# ---------------------------------------------------------------------------
provenance_groups = [
    {
        'claim_id': 'xq1-treatment-decision-context',
        'claim': '治疗决策需在指南指征、专家共识分歧与个体症状之间权衡',
        'disputed': False,
        'required_provenance_groups': [
            {'group_id': 'guideline-indications', 'sources': ['52215270:2326510132', '52215270:1909462572', '52215270:2071906039922963690']},
            {'group_id': 'consensus-divergence', 'sources': ['52215270:975101683', '52215270:2874637547', '52215270:3156697298']},
            {'group_id': 'individual-asymptomatic-view', 'sources': ['52215270:1466037599', '52215270:2275231958', '3376603186:28820202588']},
        ],
    },
    {
        'claim_id': 'xq2-gastric-cancer-evidence-chain',
        'claim': 'Hp 是胃癌 I 类致癌物与主要可控危险因素（循证链条完整）',
        'disputed': False,
        'required_provenance_groups': [
            {'group_id': 'epidemiology-cohort', 'sources': ['533032588:2712153634', '52215270:1829396577', '533032588:2490038697']},
            {'group_id': 'mechanism-review', 'sources': ['533032588:83325887262', '616791818:91125298017', '533032588:2508198156']},
            {'group_id': 'guideline-classification', 'sources': ['533032588:2488047450', '52215270:1809284916', '52215270:2284692777']},
        ],
    },
    {
        'claim_id': 'xq3-side-effect-tradeoff-reality',
        'claim': '根除治疗存在真实副作用与菌群权衡（患者反馈 + 临床解释 + 获益方并存）',
        'disputed': False,
        'required_provenance_groups': [
            {'group_id': 'patient-harm-reports', 'sources': ['52215270:3312209969', '52215270:3611600579', '52215270:2789431170']},
            {'group_id': 'clinical-tradeoff-explain', 'sources': ['52215270:2275231958', '52215270:2297169997', '616791818:3255762253']},
            {'group_id': 'beneficiary-outcomes', 'sources': ['616791818:3164788252', '616791818:101231285159', '52215270:1852800531']},
        ],
    },
    {
        'claim_id': 'xq4-regimen-evolution-and-resistance',
        'claim': '治疗方案从三联演进到四联/规范疗程 10-14 天，耐药使首次规范治疗至关重要',
        'disputed': False,
        'required_provenance_groups': [
            {'group_id': 'guideline-regimens', 'sources': ['52215270:2297169997', '52215270:1497463304', '52215270:3156697298']},
            {'group_id': 'resistance-first-round-warning', 'sources': ['533032588:2487596117', '533032588:2488282061', '616791818:3164788252']},
            {'group_id': 'regimen-variants', 'sources': ['616791818:1987191518713361343', '52215270:2071906039922963690', '3376603186:25401570453']},
        ],
    },
]
for g in provenance_groups:
    for grp in g['required_provenance_groups']:
        check(grp['sources'], g['claim_id'])

# ---------------------------------------------------------------------------
# 9. Freshness family (mechanical window; FINAL fresh-relevant = adjudicated)
#    Using the same window as the harness computes mechanically.
# ---------------------------------------------------------------------------
threshold = 1787891115 - 31536000
fresh_relevant = []
for sid, meta in pool.items():
    if meta['createdTime'] and meta['createdTime'] >= threshold and sid in set(relevant):
        # adjudicated: only substantive on-topic fresh sources, exclude promo/empty
        fresh_relevant.append(sid)
# narrow: keep clearly substantive fresh ones (adjudicated by content reading)
FRESH_KEEP = {
    '52215270:2071906039922963690', '52215270:1988509248930456248', '52215270:2051757753643823511',
    '533032588:1949471360410695335',
    '616791818:91125298017', '616791818:100435850777', '616791818:105981792797', '616791818:1981386432158393643',
    '3376603186:1981743613626052804', '3376603186:1983205076735648039', '3376603186:1986353979421123733',
}
fresh_relevant = [s for s in FRESH_KEEP if s in pool]
fresh_unresolved = [s for s in fresh_relevant if s not in set(relevant)]  # should be empty
print('fresh_relevant:', sorted(fresh_relevant))

# ---------------------------------------------------------------------------
# 10. historical_authority — UNRESOLVED for all (same as pilot: no reliable
#     timestamp/age evidence in canonical schema)
# ---------------------------------------------------------------------------
historical_unresolved = [s for s in relevant]

# ---------------------------------------------------------------------------
# Assemble gold.json
# ---------------------------------------------------------------------------
gold = {
    'case_id': 'case-hpylori-treatment',
    'gold_version': 'g2-gate01-provisional-hpylori',
    'label_status_policy': 'PROVISIONAL',
    'families': {
        'relevance': {
            'label_status': 'PROVISIONAL',
            'sources': sorted(relevant),
            'unresolved_sources': [],
            'disputed_sources': [],
            'per_question': {q: sorted([s for s in relevant if s.startswith(q + ':')]) for q in QIDS},
            'note': 'relevance gate: empty/nonsense/off-topic excluded (27 of 216); PROVISIONAL until second adjudication',
        },
        'must_see': {
            'label_status': 'PROVISIONAL',
            'sources': sorted(must_see),
            'unresolved_sources': [],
            'disputed_sources': [],
            'note': 'relevance-gated; proposed by execution agent BEFORE selector runs; decision-sensitive subset goes to second adjudication packet',
        },
        'aspect_membership': {
            'label_status': 'PROVISIONAL',
            'aspects': aspect_list,
            'note': 'ALL aspect ids namespaced case-hpylori-treatment:asp-*; primary_sources set = main supporting sources',
        },
        'expertise_topic_match': {
            'label_status': 'PROVISIONAL',
            'sources': sorted(expert_supported),
            'unresolved_sources': sorted([s for s in relevant if s not in set(expert_supported)]),
            'disputed_sources': [],
            'note': 'SUPPORTED = credentialed medical author/institution + topic match; UNRESOLVED excluded from num/den',
        },
        'evidence_quality': {
            'label_status': 'PROVISIONAL',
            'sources': sorted(evidence_quality),
            'unresolved_sources': sorted([s for s in relevant if s not in set(evidence_quality)]),
            'disputed_sources': [],
            'note': 'relevance-gated; evidence = guidelines/consensus/papers/cohort data/references in content',
        },
        'evidence_presence': {
            'label_status': 'MECHANICAL_CONFIRMED',
            'note': 'computed by harness from frozen corpus evidence markers',
        },
        'freshness': {
            'label_status': 'MECHANICAL_WINDOW_AND_PROVISIONAL_RELEVANCE',
            'fresh_relevant_sources': sorted(fresh_relevant),
            'unresolved_sources': [],
            'disputed_sources': [],
            'window': {
                'policy_id': 'fresh-365d-before-max-fetch',
                'window_sec': 31536000,
                'reference_epoch_sec': 1787891115,
            },
            'note': 'fresh window membership (mechanical) ∩ FINAL relevance (PROVISIONAL)',
        },
        'unique_long_tail_contribution': {
            'label_status': 'PROVISIONAL',
            'sources': long_tail,
            'unresolved_sources': [],
            'disputed_sources': [],
            'note': 'relevance-gated; low-vote but genuinely distinct informational value',
        },
        'contradiction': {
            'label_status': 'PROVISIONAL',
            'claim_clusters': contradiction_clusters,
            'note': 'schema KEEP only; stances from content reading (both sides); no provenance-derived stances',
        },
        'required_provenance_groups': {
            'label_status': 'PROVISIONAL',
            'claim_groups': provenance_groups,
            'note': 'covered iff EVERY group has >=1 selected source',
        },
        'historical_authority': {
            'label_status': 'UNRESOLVED',
            'sources': [],
            'unresolved_sources': sorted(historical_unresolved),
            'disputed_sources': [],
            'note': 'UNRESOLVED for all real case labels (canonical schema lacks reliable timestamp/age evidence); excluded from numerator and denominator',
        },
    },
    'provenance': {
        'proposed_by': 'execution-agent (P1 gate-01 experiment builder)',
        'proposed_method': 'full-corpus content reading (216 captured sources) before any selector result; labels cross-checked against question-level context',
        'adjudicated_by': 'PENDING — ChatGPT second adjudication (decision-sensitive packet)',
        'adjudication_status': 'PENDING_SECOND_ADJUDICATION',
        'label_status': 'PROVISIONAL',
        'label_status_note': 'PROVISIONAL Gold frozen BEFORE strategy runs (2026-08-28T05:00Z); second adjudication packet covers ~30-50 decision-sensitive labels; if disagreements change winner -> GOLD_DECISION_SENSITIVITY=HIGH',
        'corpus_frozen': '2026-08-28T04:25Z (5 questions, 216 captured sources; verify-output valid=true)',
        'gold_frozen_before_strategy': True,
    },
}
out = os.path.join(BASE, 'cases', 'case-hpylori-treatment', 'gold.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(gold, f, ensure_ascii=False, indent=2)
print('WROTE', out)
print('gold families: relevance=%d must_see=%d aspects=%d expert=%d evidence=%d longtail=%d contra_clusters=%d xq_groups=%d' % (
    len(relevant), len(must_see), len(aspect_list), len(expert_supported), len(evidence_quality), len(long_tail), len(contradiction_clusters), len(provenance_groups)))