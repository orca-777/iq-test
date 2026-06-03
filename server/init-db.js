/**
 * 数据库初始化脚本
 * 运行: node init-db.js
 * 使用 sql.js (WebAssembly SQLite，无需原生编译)
 *
 * 也支持 Turso 云端初始化:
 *   TURSO_DATABASE_URL=libsql://xxx-turso-user.turso.io TURSO_AUTH_TOKEN=xxx node init-db.js
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data', 'assessment.db');

// 确保 data 目录存在
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
  console.log('✅ 创建 data/ 目录');
}

async function initDB() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  let db;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    console.log('✅ 已加载现有数据库');
  } else {
    db = new SQL.Database();
    console.log('✅ 创建新数据库');
  }

  // ── 建表 ──────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      part       INTEGER NOT NULL,         -- 1=认知 2=领导 3=性格
      dimension  TEXT    NOT NULL,          -- 子维度名称
      order_num  INTEGER NOT NULL,          -- 题目序号（全局）
      q_text     TEXT    NOT NULL,          -- 题干
      options    TEXT    NOT NULL,          -- JSON: [{key,text}] 或 null(Likert)
      answer     TEXT    NOT NULL,          -- 正确答案key 或 '' (Likert)
      q_type     TEXT    NOT NULL,          -- mc / sjt / likert
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT    NOT NULL UNIQUE,
      password_hash TEXT   NOT NULL,
      role         TEXT    NOT NULL DEFAULT 'readonly', -- super / exam_admin / readonly
      display_name TEXT    NOT NULL DEFAULT '',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      last_login   TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS assessment_results (
      id               TEXT PRIMARY KEY,
      name             TEXT    NOT NULL,
      timestamp        TEXT    NOT NULL,
      overall_score    REAL,
      cognitive_score  REAL,
      cognitive_level  TEXT,
      leadership_score REAL,
      leadership_level TEXT,
      personality_score REAL,
      personality_level TEXT,
      cog_correct      INTEGER DEFAULT 0,
      lead_correct     INTEGER DEFAULT 0,
      likert_total     INTEGER DEFAULT 0,
      sub_scores       TEXT,
      answers          TEXT
    )
  `);

  // ── 默认配置 ──────────────────────────────────────────────
  const defaultSettings = [
    ['shuffle_questions', 'true'],
    ['exam_duration_minutes', '60'],
  ];
  const settingStmt = db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
  );
  for (const [k, v] of defaultSettings) settingStmt.run([k, v]);
  settingStmt.free();

  // ── 管理员账号 ──────────────────────────────────────────────
  const existingUsers = db.exec('SELECT COUNT(*) as cnt FROM admin_users');
  const userCount = existingUsers[0]?.values[0]?.[0] || 0;

  if (userCount === 0) {
    const adminHash  = bcrypt.hashSync('admin123', 10);
    const examHash   = bcrypt.hashSync('exam123', 10);
    const readHash   = bcrypt.hashSync('read123', 10);

    const userStmt = db.prepare(
      `INSERT INTO admin_users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)`
    );
    userStmt.run(['admin',      adminHash, 'super',      '超级管理员']);
    userStmt.run(['examadmin',  examHash,  'exam_admin', '考务管理员']);
    userStmt.run(['viewer',     readHash,  'readonly',   '只读用户']);
    userStmt.free();
    console.log('✅ 初始账号已创建: admin/admin123 | examadmin/exam123 | viewer/read123');
  } else {
    console.log(`ℹ️  账号已存在 (${userCount} 个)，跳过`);
  }

  // ── 题库 ──────────────────────────────────────────────────
  const existingQ = db.exec('SELECT COUNT(*) as cnt FROM questions');
  const qCount = existingQ[0]?.values[0]?.[0] || 0;

  if (qCount === 0) {
    console.log('📥 正在导入题库 (60题)...');
    const qStmt = db.prepare(
      `INSERT INTO questions (part, dimension, order_num, q_text, options, answer, q_type) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const QUESTIONS = getQuestions();
    for (const q of QUESTIONS) {
      qStmt.run([q.part, q.dimension, q.order_num, q.q_text, JSON.stringify(q.options), q.answer, q.q_type]);
    }
    qStmt.free();
    console.log(`✅ 导入完成，共 ${QUESTIONS.length} 题`);
  } else {
    console.log(`ℹ️  题库已有 ${qCount} 题，跳过导入`);
  }

  // 保存数据库文件
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();
  console.log(`✅ 数据库已保存: ${DB_PATH}`);
  console.log('\n🎉 初始化完成！账号信息:');
  console.log('   超级管理员: admin / admin123');
  console.log('   考务管理员: examadmin / exam123');
  console.log('   只读用户:   viewer / read123');
}

// ── 完整题库数据 ───────────────────────────────────────────────
function getQuestions() {
  const mc = (part, dim, num, text, opts, ans) => ({
    part, dimension: dim, order_num: num,
    q_text: text,
    options: opts.map((t, i) => ({ key: String.fromCharCode(65 + i), text: t })),
    answer: ans,
    q_type: part === 1 ? 'mc' : 'sjt'
  });
  const likert = (dim, num, text) => ({
    part: 3, dimension: dim, order_num: num,
    q_text: text,
    options: [
      { key: '1', text: '完全不符合' },
      { key: '2', text: '不太符合' },
      { key: '3', text: '一般' },
      { key: '4', text: '比较符合' },
      { key: '5', text: '完全符合' }
    ],
    answer: '',
    q_type: 'likert'
  });

  return [
    // ── PART 1 认知能力 ──────────────────────────────────────
    // 逻辑推理 1-6
    mc(1,'逻辑推理',1,
      '已知：所有A都是B，有些B是C。以下哪项一定正确？',
      ['所有A都是C','有些C是A','所有B都是A','有些B不是C','以上都不一定正确'],'E'),
    mc(1,'逻辑推理',2,
      '五名学生（A、B、C、D、E）坐在一排连续的5个座位上。已知：(1)A坐在B的左边。(2)C坐在其中一个端头（第1位或第5位）。(3)D坐在A和C之间。(4)E坐在D的右边。谁坐在最中间的座位（第3位）？',
      ['A','B','C','D','E'],'A'),
    mc(1,'逻辑推理',3,
      '三个人（A、B、C）进行象棋循环赛，每两人之间比赛一次，无平局。已知：(1)A赢了B。(2)C至少赢了一场比赛。(3)B一场都没赢。以下哪项一定为真？',
      ['C赢了A','C赢了B','A赢了C','A赢了所有比赛','C赢了所有比赛'],'B'),
    mc(1,'逻辑推理',4,
      '某公司全员投票：如果小张当选，则小李未当选；小王当选当且仅当小赵当选；或者小李当选，或者小赵当选（两者至少一人当选）。已知小张当选，以下哪项必然为真？',
      ['小王和小赵都当选','小李当选','小王落选而小赵当选','小王落选','小李和小赵都落选'],'A'),
    mc(1,'逻辑推理',5,
      '一个数列遵循：每个数字是其前一个数字的各位数字平方和。例如：85→8²+5²=89→8²+9²=145→… 从4开始，若干步后数列进入循环。哪个数字一定存在于这个循环中？',
      ['37','32','77','86','91'],'A'),
    mc(1,'逻辑推理',6,
      '四个正整数从小到大：W < X < Y < Z。已知：(1)W + X = 3；(2)Y + Z = 11；(3)Z − W = 7。求 Z 的值。',
      ['5','6','7','8','9'],'D'),

    // 数字推理 7-12
    mc(1,'数字推理',7,
      '2, 6, 18, 54, 162, ? 找出规律，填写问号处的数字。',
      ['324','432','486','540','648'],'C'),
    mc(1,'数字推理',8,
      '8, 27, 64, 125, ? 找出规律，填写问号处的数字。',
      ['144','169','216','225','256'],'C'),
    mc(1,'数字推理',9,
      '已知：A × B = 48；B × C = 72；A × C = 96。求 A + B + C = ?',
      ['20','22','24','26','28'],'D'),
    mc(1,'数字推理',10,
      '2, 3, 5, 7, 11, 13, 17, ? 找出规律，填写问号处的数字。',
      ['18','19','20','21','23'],'B'),
    mc(1,'数字推理',11,
      '有A、B两个水桶，A桶容量是B桶的3倍。从A桶倒出15升到B桶后，两桶水量相等。最初A桶有多少升水？',
      ['30升','45升','60升','75升','90升'],'B'),
    mc(1,'数字推理',12,
      '数列定义：第n项 = 第(n−1)项 + 第(n−2)项。已知：a₁ = 1，a₂ = 3。求第7项 a₇ = ?',
      ['21','24','27','29','32'],'D'),

    // 空间推理 13-18
    mc(1,'空间推理',13,
      '正方体展开图：A在顶部，B/C/D在中间一行，E在底部，F在E下方。折成正方体后，如果A面朝上，哪一面一定朝下（与A相对）？',
      ['B面','C面','D面','E面','F面'],'D'),
    mc(1,'空间推理',14,
      '一个3×3×3的立方体由27个小立方体组成。从最外层表面除去所有能看到的小立方体（六面全部除去一层）。还剩下多少个小立方体？',
      ['1个','7个','8个','19个','27个'],'A'),
    mc(1,'空间推理',15,
      '将一张正方形纸沿对角线对折两次，再在折好的三角形的直角处剪掉一个角，展开纸张后会有多少个小孔？',
      ['1个','2个','4个','8个','0个'],'C'),
    mc(1,'空间推理',16,
      '一个物体：俯视图为圆形，正视图为圆形，侧视图为圆形。这个物体最可能是什么形状？',
      ['半球体','圆锥体','圆柱体','球体','立方体'],'D'),
    mc(1,'空间推理',17,
      '4×4网格中，●分布在中间2×2区域（行2-3，列2-3）。绕中心顺时针旋转90°，再向右+向下各平移1格。描述正确的是？',
      ['●集中在右上角2×2','●集中在右下角2×2','●集中在左下角2×2','●集中在左上角2×2','●分散在四个角落'],'B'),
    mc(1,'空间推理',18,
      '用单位立方体拼成立体图形，从正前方看：底行3块/中行2块/顶行1块；从正上方看：后行1块/中行2块/前行3块。最少使用了多少个立方体？',
      ['6个','7个','8个','9个','10个'],'A'),

    // 图形推理 19-24
    mc(1,'图形推理',19,
      '3×3矩阵：第1行为1/2/3个白圆，第2行为1/2/3个黑圆，第3行前两格为"1白1黑"/"2白2黑"，问号处应为？',
      ['一个白圆','三个黑圆','三个白圆','一白两黑','三白三黑（各3个）'],'E'),
    mc(1,'图形推理',20,
      '五组图形中，四组变化规律相同，找出不同类的一组：A: ▢→◇→○  B: △→▽→◇  C: ○→▢→△  D: ◇→○→▢  E: ▢→△→○',
      ['A','B','C','D','E'],'B'),
    mc(1,'图形推理',21,
      '图形序列：第1个1块，第2个2块，第3个3块，第4个4+1块（两行），第5个5+2块（两行）。第6个图形应该是？',
      ['一行六个','四行1-2-3-4个','两行：6个+3个','三行4-5-6个','两行：6个+4个'],'C'),
    mc(1,'图形推理',22,
      '图形序列：1:●  2:●●  3:●●●  4:●/●/●（三行各1）  5:●●/●●（两行各2）  6:●●●/●●●/●●●（三行各3）。第7个图形是什么？',
      ['一个点','两个点并排','六个点一行','四个点竖排','六点两行（每行3个，共2行）'],'E'),
    mc(1,'图形推理',23,
      '图形序列外框+内部标记：1:[○]有·  2:(△)有▲  3:{□}有■  4:<◇>有◆。第5个图形最可能是什么？',
      ['(○)有●','[□]有■','{△}有▲','<○>有●','[◇]有◆'],'C'),
    mc(1,'图形推理',24,
      '成对图形：◇→◆；□→■；○→●；△→?',
      ['▲','▽','△','◆','●'],'A'),

    // 言语推理 25-30
    mc(1,'言语推理',25,
      '医生 : 诊断 :: 律师 : ?  选择最匹配的类比关系。',
      ['辩护','起诉','谈判','仲裁','调解'],'A'),
    mc(1,'言语推理',26,
      '这位管理者对市场趋势的洞察力可谓_______，在行业变动之前总能提前预判并做好准备。最恰当的词语是？',
      ['洞若观火','隔岸观火','走马观花','管中窥豹','雾里看花'],'A'),
    mc(1,'言语推理',27,
      '找出以下成语中与其他四个不同类的一项：A.画蛇添足  B.守株待兔  C.掩耳盗铃  D.刻舟求剑  E.亡羊补牢',
      ['画蛇添足','守株待兔','掩耳盗铃','刻舟求剑','亡羊补牢'],'E'),
    mc(1,'言语推理',28,
      '"创新" 对于 "突破" 相当于 "积累" 对于：',
      ['质变','重复','存储','渐进','堆积'],'A'),
    mc(1,'言语推理',29,
      '________的决策往往源于________的信息收集，两者之间存在着________的联系。最恰当的填入是？',
      ['明智/全面/密切','草率/片面/直接','果断/零散/间接','谨慎/深入/微弱','大胆/充分/偶然'],'A'),
    mc(1,'言语推理',30,
      '以下词语中，有一个与其他四个在逻辑关系上不同类：A.战略 B.战术 C.战役 D.战场 E.战士',
      ['战略','战术','战役','战场','战士'],'E'),

    // ── PART 2 领导潜质 SJT ───────────────────────────────────
    mc(2,'战略思维',31,
      '你刚接手一个新项目，发现前任留下的遗留问题很多，团队成员士气低落都在等你的指示。你会：',
      ['立即制定详细执行计划并分配任务，让团队尽快动起来',
       '先花一周时间深入调研，彻底分析问题根源后再制定方案',
       '快速走访团队成员了解现状，识别最关键问题后制定初步方案',
       '向上级申请更换团队成员，重新组建项目团队'],'C'),
    mc(2,'战略思维',32,
      '公司计划进入一个新业务领域，领导让你负责可行性分析。你会：',
      ['亲自完成全部调研分析工作，确保信息准确全面',
       '组建跨职能小组，分工收集市场、技术、财务等不同维度信息',
       '委托外部咨询公司出具专业报告，节省内部精力',
       '查阅行业公开报告后直接向领导给出初步建议'],'B'),
    mc(2,'战略思维',33,
      '你负责的部门预算被削减20%，但核心KPI不变。你会：',
      ['向上级据理力争，争取恢复预算',
       '维持原有计划不变，削减日常开支凑齐预算',
       '重新梳理所有项目优先级，将资源集中投入产出最高的核心项目',
       '请求其他部门资源共享弥补缺口'],'C'),

    mc(2,'决策判断',34,
      '团队对项目方案存在严重分歧，两派各执己见，项目已延期一周。你会：',
      ['直接做出最终决策并推进执行',
       '组织双方进行结构化辩论，用数据和事实验证各自方案后再决定',
       '让团队成员投票表决，少数服从多数',
       '向上级汇报请示决策'],'B'),
    mc(2,'决策判断',35,
      '一个重要客户提出了超出现有服务范围的紧急需求，答应会影响其他客户服务，拒绝可能影响长期合作。你会：',
      ['坚持公司服务标准，礼貌而坚定地拒绝',
       '评估需求的真实商业价值后，提出有条件的折中方案',
       '先答应客户需求，再在内部加班赶工完成',
       '请示上级定夺'],'B'),
    mc(2,'决策判断',36,
      '你发现公司沿用多年的某项业务流程存在明显效率问题，但改变它需要多个部门配合。你会：',
      ['先在自身团队内小范围试行改进方案，用效果数据说话后再推广',
       '在跨部门会议上正式提出改进建议并推动讨论',
       '直接向高层领导提交完整的改革方案',
       '既然涉及其他部门，等公司统一安排改革'],'A'),

    mc(2,'团队管理',37,
      '团队中一位资历较深的老员工工作能力出色，但经常不遵守协作规范，影响了团队整体效率。你会：',
      ['在团队会议上重申协作规范，不点名但让所有人注意',
       '私下与其深入沟通，了解原因并共同制定改进方案',
       '调整工作安排减少其与团队的协作需求',
       '向上级反映此问题寻求指导'],'B'),
    mc(2,'团队管理',38,
      '你被任命带领一个跨部门临时项目组，成员互不熟悉且各有本职工作。第一步你会：',
      ['制定清晰的项目计划、角色分工和沟通机制，让每位成员明确职责',
       '先组织团队活动增进彼此了解和信任',
       '直接分配任务尽快启动项目',
       '让各部门自行推荐人员并自行协调'],'A'),
    mc(2,'团队管理',39,
      '团队刚完成一个高强度的重点项目，成员们都很疲惫。此时上级要求立即启动下一个紧急项目。你会：',
      ['明确向上级反映团队状态，争取缓冲时间',
       '评估新项目紧急程度，合理安排人员轮换确保可持续作战',
       '直接启动新项目，团队会在执行中自行调整',
       '主动承担更多工作以减轻团队压力'],'B'),

    mc(2,'沟通协调',40,
      '你有一个改进工作流程的新想法，可能影响多个部门的现有工作方式，预计会有一些阻力。你会：',
      ['准备详细的改进方案和数据支撑，选择一个部门先行试点用效果说服更多人',
       '在全公司会议上正式提出方案并答疑',
       '先私下与各部门负责人逐一沟通，争取关键支持后再正式推进',
       '等待合适的时机再提出想法'],'C'),
    mc(2,'沟通协调',41,
      '你的直属上级对你负责的项目方向与你看法不同，你认为自己的方案更符合业务实际。你会：',
      ['坚持己见，按自己的方案执行',
       '准备详实的数据和案例，与上级进行一对一沟通充分阐述理由',
       '按上级意见执行，保留自己的看法',
       '提出一个折中方案各让一步'],'B'),
    mc(2,'沟通协调',42,
      '跨部门协作中，另一个部门迟迟未能交付你所需的资源，你的项目进度已受影响。你会：',
      ['发送正式邮件催促并抄送双方领导',
       '约对方负责人面谈，了解实际困难后共同寻找解决方案',
       '调整项目计划不再依赖该部门',
       '向上级汇报请求高层协调'],'B'),

    mc(2,'责任担当',43,
      '团队项目出现重大失误，造成一定损失。经调查，主要原因是上级此前的决策有误。领导追问责任时，你会：',
      ['客观说明情况，指出决策失误的原因',
       '主动承担项目管理责任，同时提出系统性改进建议',
       '保持沉默不做评论',
       '将责任归因于外部客观因素'],'B'),
    mc(2,'责任担当',44,
      '你发现一位与你关系不错的同事在工作中存在违规操作，长期下去可能带来合规风险。你会：',
      ['私下善意提醒对方，帮助其认识到问题并自觉纠正',
       '按照公司规定向上级或合规部门报告',
       '假装没有注意到，避免影响关系',
       '在适当的场合委婉提及此事'],'A'),
    mc(2,'责任担当',45,
      '公司需要有人负责一项难度很高、成功率不确定的前沿项目，其他同事都表现犹豫。你会：',
      ['主动请缨承担，视为个人成长和突破的机会',
       '等待领导指派，被选中就认真完成',
       '以当前工作饱和为由婉拒',
       '条件性接受，要求额外资源和支持才接手'],'A'),

    // ── PART 3 性格特质 Likert ─────────────────────────────────
    likert('尽责性',46,'我总是提前制定计划，很少等到最后一刻才开始行动。'),
    likert('尽责性',47,'即使没有人监督，我也能自觉保持工作质量的高标准。'),
    likert('尽责性',48,'完成任务后，我通常会仔细检查以确保没有疏漏。'),

    likert('情绪稳定性',49,'面对突发状况或意外变化时，我能够保持冷静并迅速做出应对。'),
    likert('情绪稳定性',50,'工作中遇到挫折或批评后，我能较快调整心态继续前进。'),
    likert('情绪稳定性',51,'在时间紧迫或任务繁重的情况下，我的表现依然保持稳定。'),

    likert('开放性',52,'我乐于接触和学习自己专业领域之外的新知识和新技能。'),
    likert('开放性',53,'面对与自己不同的观点或做法，我持开放态度并愿意尝试理解。'),
    likert('开放性',54,'我经常主动思考如何优化和改进现有的工作方式或流程。'),

    likert('宜人性',55,'当同事遇到困难时，我通常愿意主动提供帮助和支持。'),
    likert('宜人性',56,'即使与他人意见不合，我也能尊重对方的立场并耐心沟通。'),
    likert('宜人性',57,'在团队合作中，我更倾向于通过协作而非竞争来达成目标。'),

    likert('外向性',58,'在社交场合中，我能够自然地与不熟悉的人建立联系和交流。'),
    likert('外向性',59,'我喜欢在团队讨论或公开场合中表达自己的想法和见解。'),
    likert('外向性',60,'进入新的工作环境或团队时，我通常能较快融入并建立人际关系。'),
  ];
}

initDB().catch(console.error);
