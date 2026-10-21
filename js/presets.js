/* Stars-AI · 一键预设
 * 两个工坊：✦ 二次元工坊（view:"anime"）· 🔞 NSFW 工坊（view:"nsfw"）
 * 每个预设 = 分类(cat) + 模式 + 提示词（可改）+ 参数；applyPreset 时一次性填进面板。
 * 加功能只加一条对象：cat 决定它落在哪个分类下面，渲染代码不用动。
 */
(function (global) {
  "use strict";

  /* 分类表：卡片按这里的顺序分组显示（面板上方的分类条也是这张表生成的）。
   * 以后功能变多：先在这里加一个分类，再给预设写 cat: 新分类 id 就行。
   * 分类 id 重复使用没问题（anime 和 nsfw 各自独立）。 */
  var CATS = {
    anime: [
      { id: "style", label: "画风" },
      { id: "light", label: "光影" },
      { id: "chibi", label: "Q版贴纸" },
      { id: "scene", label: "背景场景" },
      { id: "outfit", label: "造型" },
      { id: "expression", label: "神态" },
      { id: "quality", label: "画质" },
      { id: "local", label: "局部" }
    ],
    nsfw: [
      { id: "outfit", label: "服装类" },
      { id: "accessory", label: "配饰" },
      { id: "body", label: "身体类" },
      { id: "skin", label: "肤质" },
      { id: "expression", label: "表情" },
      { id: "scene", label: "场景光线" },
      { id: "local", label: "局部重绘" }
    ]
  };

  /* 一个事实（改提示词前值得知道）：Qwen-Image 的预设全部用 cfg=1，
   * 而 CFG 采样是 uncond + cfg*(cond-uncond) —— cfg=1 时 negative 的权重为 0。
   * 也就是这些 negative 词在 Qwen 模式下不参与采样，只有切到 SD 架构（cfg 6–7）才生效。
   * 提示词内容以"出图效果"为准，别为了这条去改已经在用的提示词。
   */

  /* NSFW 预置的强制负面词：只做成年向内容，任何"幼态/未成年"特征一律排除。
   * 这条不是装饰——二次元模型很容易被练成童颜，必须每张图都带上。 */
  var NSFW_NEG = "未成年人, 儿童, 童颜, 幼态, 萝莉, 学生妹, 校服童装, child, kid, teen, loli, shota, 年幼, 幼稚脸, 畸形, 多余的手指, 融合的肢体, 错误解剖, 文字, 水印, 低质量, 模糊";

  var LIST = [
    /* ---------- 二次元 · 画风 ---------- */
    {
      id: "to_anime", view: "anime", cat: "style", label: "二次元化", icon: "🎨", desc: "照片 / 半成品 → 动漫", mode: "edit",
      prompt: "把这张图转换成日系动漫插画风格：干净利落的线稿、赛璐璐平涂上色、柔和渐变光影、简洁背景，人物的五官、发型、姿态和构图保持不变",
      negative: "照片, 写实, 3D渲染, 厚涂, 模糊, 噪点, 低质量, 多余的手指",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "最常用：照片/半成品 → 动漫风"
    },
    {
      id: "style_ghibli", view: "anime", cat: "style", label: "吉卜力风", icon: "🌸", desc: "柔和手绘 · 自然光", mode: "edit",
      prompt: "把这张图转换成吉卜力动画风格：水彩感的柔和背景、干净的手绘线条、温暖自然的日光与层次分明的云层，人物五官简化但神态生动，保留原有的构图、人物姿态与配色关系",
      negative: "3D渲染, 照片, 厚涂, 过度锐化, 噪点, 变形, 模糊",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "柔和手绘 + 自然光；适合带风景的构图"
    },
    {
      id: "style_shinkai", view: "anime", cat: "style", label: "新海诚风", icon: "✨", desc: "天空光效 · 镜头光晕", mode: "edit",
      prompt: "把这张图转换成新海诚动画电影风格：通透的高饱和天空、细密的云层与镜头光晕、晴日或黄昏的强烈逆光、细腻的光斑与空气感，人物线条干净、色彩明亮，保留原有构图与人物姿态",
      negative: "灰暗, 低饱和, 写实照片, 3D渲染, 噪点, 模糊",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "天空光效 + 镜头光晕；画面里留点天空效果最好"
    },
    {
      id: "style_90s", view: "anime", cat: "style", label: "90s 复古赛璐璐", icon: "🎬", desc: "胶片颗粒 · 高对比", mode: "edit",
      prompt: "把这张图转换成 1990 年代日本动画的赛璐璐风格：明显的平涂色块、略粗的手绘描边、胶片颗粒与轻微色偏、高对比的光影分层，人物比例保留但线条更硬朗",
      negative: "现代厚涂, 3D渲染, 照片, 过度锐化, 色彩过于通透, 低质量",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "胶片颗粒 + 高对比，复古味最重的一张"
    },
    {
      id: "style_painterly", view: "anime", cat: "style", label: "厚涂插画", icon: "🖌️", desc: "笔触可见 · 体积感", mode: "edit",
      prompt: "把这张图转换成厚涂数字插画风格：可见的笔触与颜料堆叠、强烈的体积感与明暗对比、边缘有绘画性的松紧变化，人物结构保持准确，保留原有构图与姿态",
      negative: "平涂, 线稿, 赛璐璐, 照片, 涂抹感过重, 模糊",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "适合游戏立绘；细节多的人物最容易出效果"
    },
    {
      id: "style_manga", view: "anime", cat: "style", label: "黑白漫画", icon: "🖤", desc: "网点 + 排线", mode: "edit",
      prompt: "把这张图转换成黑白漫画：纯黑与纯白的二分光影、密集的网点与排线、干净的印刷质感，人物表情与构图保留，去掉所有彩色",
      negative: "彩色, 灰度渐变, 照片, 3D渲染, 线条脏乱, 模糊",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "出图可直接当漫画素材；想要线稿另说"
    },
    {
      id: "style_lightnovel", view: "anime", cat: "style", label: "轻小说封面", icon: "📖", desc: "留白构图 · 通透上色", mode: "edit",
      prompt: "把这张图处理成轻小说封面的构图与质感：人物偏画面一侧、另一侧留出干净的负空间给标题，通透的平涂上色、柔和的高光、精致的发丝与眼睛细节，整体明亮讨喜，保留人物特征",
      negative: "构图拥挤, 满画面元素, 暗淡, 照片, 3D渲染, 模糊",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "会重排构图腾出标题位；人物尽量偏一侧"
    },
    {
      id: "style_gongbi", view: "anime", cat: "style", label: "国风工笔", icon: "🏮", desc: "细线勾勒 · 矿物色", mode: "edit",
      prompt: "把这张图转换成中国工笔画风格：极其细腻的细线勾勒、柔和的矿物色平涂与层层分染、素净的留白背景、精致的纹样与衣纹，人物五官清秀，保留原有构图与姿态",
      negative: "水墨晕染, 油画厚涂, 照片, 3D渲染, 线条粗糙, 模糊",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "和水墨的区别：工笔线条清晰不晕染"
    },

    /* ---------- 二次元 · 光影 ---------- */
    {
      id: "light_backlit", view: "anime", cat: "light", label: "逆光氛围", icon: "🌇", desc: "轮廓光 · 空气感", mode: "edit",
      prompt: "把画面的光线改成强烈的逆光：主体边缘出现明亮的轮廓光、发丝透光，背景化为柔和的亮部，正面留出柔和的暗部但保留细节，空气中有细小的光斑与浮尘；人物、构图和背景内容保持不变",
      negative: "正面打光, 平光, 灰暗, 死黑, 过曝到丢失细节, 变形",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "只改光不改内容；逆光轮廓 + 空气感"
    },
    {
      id: "light_volumetric", view: "anime", cat: "light", label: "体积光", icon: "💡", desc: "丁达尔 · 光柱光尘", mode: "edit",
      prompt: "在画面里加入体积光：从窗外或树隙射入的清晰光柱、空气中可见的光尘与薄雾，光柱落在主体与环境上形成明暗层次；人物、构图与背景内容保持不变",
      negative: "光柱生硬, 光斑过曝, 灰雾糊成一片, 平光, 变形, 低质量",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "强调光柱与空气感；配合「吉卜力风」很稳"
    },

    /* ---------- 二次元 · Q 版 / 贴纸 ---------- */
    {
      id: "chibi_style", view: "anime", cat: "chibi", label: "整体 Q 版", icon: "🍬", desc: "整张转二头身", mode: "edit",
      prompt: "把整张画转换成可爱的 Q 版（chibi）风格：二头身、大头圆脸、大眼睛、简化四肢与细节、柔和描边与干净平涂上色，保留人物服饰特征、配色和构图",
      negative: "写实比例, 细长四肢, 复杂细节, 噪点, 模糊",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "整张图 Q 版化，适合做头像"
    },
    {
      id: "chibi_add", view: "anime", cat: "chibi", label: "Q 版小人", icon: "🧸", desc: "透明底小人贴纸", mode: "edit",
      cutout: true,
      prompt: "把画面里的人物转换成可爱的 Q 版（chibi）单个人物：{fill}。要求全身完整、姿态自然、四肢不被裁切；纯白色背景，画面里只有一个角色，不要任何背景元素，不要投影、阴影、地面或环境光",
      negative: "背景, 场景, 阴影, 投影, 地面, 多个人物, 裁切, 变形, 写实比例, 文字, 水印",
      fill: {
        label: "风格", placeholder: "也可以自己写，例如：黏土质感",
        default: "平面二次元（平涂赛璐璐、干净描边、纯色块）",
        chips: [
          "平面二次元（平涂赛璐璐、干净描边、纯色块）",
          "毛绒玩偶（布料缝线、蓬松绒毛、像毛绒玩具）",
          "3D 渲染（柔和体积光、次表面散射、光滑材质）"
        ]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "生成后会自动抠主体成透明图层（不带影子）"
    },
    {
      id: "sticker_cutout", view: "anime", cat: "chibi", label: "透明底贴纸", icon: "🏷️", desc: "任意角色 · 抠成 PNG", mode: "edit",
      cutout: true,
      prompt: "把画面里的主体完整地做成一张贴纸：保留人物原本的画风与全部细节，纯白色背景，画面里只有这一个主体，不要背景元素，不要投影、阴影、地面或环境光；主体完整、边缘干净、不被裁切",
      negative: "背景, 场景, 阴影, 投影, 地面, 多个主体, 裁切, 变形, 文字, 水印",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "出图后自动抠成透明图层；不限于 Q 版，任何角色都能做"
    },
    {
      id: "chibi_full", view: "anime", cat: "chibi", label: "Q 版全身立绘", icon: "🧍", desc: "站姿全身 · 简洁背景", mode: "edit",
      prompt: "把画面里的人物转换成 Q 版（chibi）全身立绘：二头身、大头圆脸、大眼睛，站姿自然放松、四肢完整不被裁切，全身完整入镜；简洁的浅色渐变背景，保留人物的发型、服装特征与配色",
      negative: "裁切, 只到半身, 变形, 多余肢体, 写实比例, 背景杂乱, 阴影过重, 文字, 水印",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "站姿全身 + 简洁背景，适合做立绘素材"
    },

    /* ---------- 二次元 · 背景场景 ---------- */
    {
      id: "bg_change", view: "anime", cat: "scene", label: "更换背景", icon: "🖼️", desc: "保留人物换场景", mode: "edit",
      prompt: "把背景换成{fill}：人物保持原样（姿势、发型、五官、服装都不变），主体边缘干净自然，新背景的透视、光线方向与色温和人物一致，必要时给人物补上环境光与接地阴影",
      negative: "人物变形, 换脸, 边缘毛刺, 透视错位, 光影不符, 模糊",
      fill: {
        label: "换成什么背景", placeholder: "例如：雨夜的霓虹街道",
        default: "柔和的浅灰渐变摄影棚背景",
        chips: ["柔和的浅灰渐变摄影棚背景", "纯白背景", "粉蓝渐变", "雨夜霓虹街道", "黄昏海边", "日式和室", "樱花树林", "教室窗边", "雪景街道"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "只换背景，人物尽量不动"
    },
    {
      id: "blend", view: "anime", cat: "scene", label: "人物溶图", icon: "🧩", desc: "人物放进背景图", mode: "edit",
      needsBgImage: true,
      prompt: "把第一张图里的人物自然地放进第二张图的场景：匹配场景的光线方向、色温与环境色，在人物脚下与接触面添加真实的投影和遮蔽，处理边缘过渡与景深，人物样貌、发型和服装保持不变",
      negative: "生硬拼接, 边缘白边, 光影不符, 比例失调, 变形, 模糊",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "当前画布 = 人物，另选一张图当背景"
    },
    {
      id: "blend_object", view: "anime", cat: "scene", label: "图片融合", icon: "🧷", desc: "物体放进画面 · 光影对齐", mode: "edit",
      extraImage: { label: "融合物体", placeholder: "把物体图拖进面板，或点「选择」" },
      prompt: "把第二张图里的物体自然地融合进第一张图的场景：摆在符合透视与接触关系的位置，按画面主光方向给它真实的投影和接触阴影，让它接受环境光与色温（必要时补一点环境反光），边缘过渡干净自然；物体本身的外观、材质与颜色保持不变，整体光影统一",
      negative: "生硬拼接, 边缘白边, 光影不符, 比例失调, 悬浮没有投影, 颜色偏色, 穿插, 模糊, 低质量",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "当前画布 = 场景，拖进来的图 = 要放进去的物体"
    },
    {
      id: "sky_change", view: "anime", cat: "scene", label: "换天空·季节", icon: "🌤", desc: "雪 / 樱花 / 雷雨 / 晚霞", mode: "edit",
      prompt: "把天空和时令换成{fill}：云层形态、光线方向与色温统一，环境光、地面反光和人物身上的受光随之匹配；人物与建筑的位置、姿态和构图保持不变",
      negative: "光影不符, 天空接缝, 人物变形, 透视错位, 云层糊成一片, 模糊",
      fill: {
        label: "换成什么天空", placeholder: "例如：飘雪的冬日 / 樱花飞舞的春日",
        default: "晴朗的蓝天白云",
        chips: ["晴朗的蓝天白云", "飘雪的冬日天空", "樱花飞舞的春日", "乌云密布的雷雨天", "秋天红叶的黄昏", "夏日积云", "火烧云晚霞", "星空银河"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "只换天空与季节感；要连地面场景一起换，用「更换背景」"
    },
    {
      id: "scene_place", view: "anime", cat: "scene", label: "换场景", icon: "🏫", desc: "教室 / 神社 / 咖啡店 / 商店街", mode: "edit",
      prompt: "把背景换成{fill}：场景的空间透视、材质与光线方向合理，人物与环境接触的位置有真实的阴影与反光，环境色温统一；人物本身的样貌、发型、服装和姿势保持不变",
      negative: "透视错位, 光影不符, 悬浮, 边缘毛刺, 人物变形, 模糊",
      fill: {
        label: "换成什么场景", placeholder: "例如：教室窗边 / 神社石阶",
        default: "教室窗边",
        chips: ["教室窗边", "神社石阶", "咖啡店内", "傍晚的商店街", "夏日祭摊位", "森林小径", "教室走廊"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "和「更换背景」的区别：这张预置了成套场景，不用自己想词"
    },
    {
      id: "scene_weather", view: "anime", cat: "scene", label: "换天气", icon: "🌧", desc: "雨 / 雪 / 雾 / 夜晚", mode: "edit",
      prompt: "把画面的天气换成{fill}：降水、雾气或光线状态与原有的场景结构匹配，地面有相应的湿润、积水或积雪反光，人物身上的受光与反射跟着改变；人物与构图保持不变",
      negative: "天气与场景不符, 生硬的叠加, 光线错乱, 人物变形, 模糊",
      fill: {
        label: "换成什么天气", placeholder: "例如：小雨 / 大雪",
        default: "小雨",
        chips: ["小雨", "大雪", "浓雾", "黄昏", "夜晚", "雷雨前的阴云"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "偏氛围与地面反光；只想换天上那片用「换天空·季节」"
    },
    {
      id: "scene_dof", view: "anime", cat: "scene", label: "景深虚化", icon: "💨", desc: "前后景虚化 · 焦外光斑", mode: "edit",
      prompt: "给画面加上自然的景深：人物的面部与身体保持清晰锐利，前景与背景按距离渐变虚化，出现柔和的焦外光斑，虚化过渡自然；不改变人物、构图与画面内容",
      negative: "全图虚化, 主体也模糊, 光斑过曝, 边缘出现白边, 变形",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "只做虚化，主体不动；拍照味最浓的一张"
    },
    {
      id: "scene_falling", view: "anime", cat: "scene", label: "飘落物", icon: "🌸", desc: "樱花瓣 / 落叶 / 雪花 / 光斑", mode: "edit",
      prompt: "在画面里加入飘落的{fill}：大小、疏密与近大远小的透视关系自然，靠近镜头的一层轻微虚化，落在人物身上或前景的点缀有相应的接触与遮挡；人物与构图保持不变",
      negative: "元素糊成一片, 大小一致没有透视, 遮挡面部, 生硬的叠加, 变形",
      fill: {
        label: "飘什么", placeholder: "例如：樱花瓣 / 雪花",
        default: "樱花瓣",
        chips: ["樱花瓣", "枫叶", "雪花", "光斑", "雨丝", "萤火虫"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "画面立刻「活」起来；注意别让它糊住脸"
    },

    /* ---------- 二次元 · 造型 ---------- */
    {
      id: "outfit", view: "anime", cat: "outfit", label: "换装·校服", icon: "👕", desc: "保留脸和姿势", mode: "edit",
      prompt: "把人物的服装换成白色水手服校服，保留原有的发型、脸、姿势、光影和背景",
      negative: "换脸, 换发型, 变形, 模糊, 低质量",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "提示词里的服装可以自己改"
    },
    {
      id: "outfit_custom", view: "anime", cat: "outfit", label: "换装·自定义", icon: "👘", desc: "JK / 汉服 / 旗袍 / 婚纱", mode: "edit",
      prompt: "把人物的服装换成{fill}：面料材质、剪裁与褶皱清晰真实，衣物自然贴合身体与姿态，版型与配饰完整；保留原有的脸、发型、体型比例、姿势、光影和背景",
      negative: "换脸, 换发型, 变形, 衣服穿插, 多余的手指, 模糊, 低质量",
      fill: {
        label: "换成什么服装", placeholder: "例如：JK 制服 / 汉服 / 旗袍 / 婚纱",
        default: "JK 水手服制服",
        chips: ["JK 水手服制服", "汉服·交领襦裙", "改良旗袍", "白色婚纱", "洛丽塔洋装", "西装礼服", "和风浴衣", "针织开衫 + 百褶裙"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "下面选一套，或自己写任意服装；原来的「换装·校服」保持不变"
    },
    {
      id: "hair_change", view: "anime", cat: "outfit", label: "换发型", icon: "💇", desc: "双马尾 / 短发 / 银发", mode: "edit",
      prompt: "把人物的发型改成{fill}：发丝的走向、发量与层次自然，刘海与新发型匹配，高光与整体色调协调；保留原有的脸型、五官、服装、姿势、光影和背景",
      negative: "换脸, 五官变形, 头发穿插, 发丝糊成一片, 模糊, 低质量",
      fill: {
        label: "换成什么发型", placeholder: "例如：双马尾 / 齐肩短发 / 银发长直",
        default: "双马尾",
        chips: ["双马尾", "齐肩短发", "银发长直", "长卷发", "高马尾", "单侧编发", "齐刘海黑长直", "空气感短卷发"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "发型和发色写在同一个框里就行，例如「银发双马尾」"
    },
    {
      id: "accessory", view: "anime", cat: "outfit", label: "配饰", icon: "👓", desc: "眼镜 / 猫耳 / 耳机 / 围巾", mode: "edit",
      prompt: "给人物加上{fill}：材质、反光与佩戴位置真实，贴合头部或身体，松紧自然、有轻微的压痕或遮挡，与整体造型和光线协调；其余部分（脸、发型、服装、姿势、背景）保持不变",
      negative: "悬浮的配饰, 穿模, 位置错乱, 材质失真, 换脸, 变形, 低质量",
      fill: {
        label: "加什么配饰", placeholder: "例如：圆框眼镜 / 猫耳发箍",
        default: "圆框眼镜",
        chips: ["圆框眼镜", "猫耳发箍", "头戴式耳机", "围巾", "发饰", "贝雷帽", "口罩"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "一次加一件最稳；要加两件就在框里写「眼镜，猫耳」"
    },
    {
      id: "hair_color", view: "anime", cat: "outfit", label: "发色", icon: "🎨", desc: "银白 / 粉 / 渐变挑染", mode: "edit",
      prompt: "把人物的发色改成{fill}：发丝的高光、暗部与渐变过渡自然，发色与整体色调和光线协调，保留原有的发型、长度与层次；脸型、五官、服装、姿势和背景不变",
      negative: "发色斑驳, 发丝糊成一片, 高光错乱, 换脸, 换发型, 变形, 低质量",
      fill: {
        label: "什么发色", placeholder: "例如：银白色 / 粉色",
        default: "银白色",
        chips: ["银白色", "粉色", "樱粉到浅金的渐变挑染", "冰蓝色", "黑色", "亚麻棕", "紫罗兰"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "只改颜色不改剪裁；要换发型用「换发型」"
    },

    /* ---------- 二次元 · 神态 ---------- */
    {
      id: "expression", view: "anime", cat: "expression", label: "换表情", icon: "😊", desc: "微笑 / 害羞 / 生气 / 惊讶", mode: "edit",
      prompt: "让人物露出{fill}的神情：眼神、眼型、眉毛和嘴角的细微变化自然，情绪传达准确；脸型、发型、服装、姿势、光线和背景都保持不变",
      negative: "夸张表情, 歪脸, 五官变形, 眼睛变形, 模糊, 低质量",
      fill: {
        label: "什么表情", placeholder: "例如：温柔微笑 / 害羞脸红",
        default: "温柔微笑",
        chips: ["温柔微笑", "害羞脸红", "生气鼓起脸颊", "惊讶睁大眼", "闭眼开心", "委屈快哭", "面无表情"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "只改神情，脸型、发型、姿势都不动"
    },

    /* ---------- 二次元 · 画质 ---------- */
    {
      id: "anime_upscale", view: "anime", cat: "quality", label: "二次元超分", icon: "⬆️", desc: "anime 模型 4×", mode: "upscale",
      upscaleMatch: "anime",
      params: { scale: 4 },
      tip: "优先用 anime 专用放大模型（4×）"
    },

    /* ---------- 二次元 · 局部（都要先在 PS 里框选） ---------- */
    {
      id: "fix_detail", view: "anime", cat: "local", label: "局部修改", icon: "🖌️", desc: "框选后按描述改这一块", mode: "inpaint", needsSelection: true,
      prompt: "把选区内的内容重画完善：{fill}。保持与周围相同的光线方向、色彩和笔触，边缘自然过渡，不改变选区外的画面",
      negative: "接缝痕迹, 边缘硬切, 风格不一致, 光影不符, 涂抹感, 模糊",
      fill: {
        label: "改成什么", placeholder: "例如：一束手捧花 / 更精致的眼睛细节",
        default: "更精细清晰的细节与质感",
        chips: ["更精细清晰的细节与质感", "补上被遮住的边缘", "换成玻璃材质", "换成金属扣环", "修正手指与关节", "添一束手捧花"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024, feather: 8, expand: 4 },
      tip: "先在 PS 里框选要改的区域，再在下面补一句「这块要变成什么」"
    },
    {
      id: "remove_obj", view: "anime", cat: "local", label: "去杂物", icon: "🧽", desc: "删路人 / 电线 / 水印", mode: "inpaint", needsSelection: true,
      prompt: "删除选区内的物体，用周围画面的结构与纹理自然无缝地补全，光照和色调保持一致",
      negative: "残留, 边缘痕迹, 模糊, 重复纹理, 新增物体",
      params: { steps: 30, cfg: 1, resolution: 1024, feather: 10, expand: 8 },
      tip: "先框选要删掉的东西（路人 / 电线 / 水印 / 杂物），框大一点更好补"
    },

    /* ---------- NSFW · 服装类（仅限 18+，需要先同意免责条款才会显示） ---------- */
    {
      id: "nsfw_outfit", view: "nsfw", cat: "outfit", label: "更换服装", icon: "👗", desc: "内衣 / 泳装 / 制服 / 睡衣 / 礼服", mode: "edit",
      prompt: "把人物的服装换成{fill}：面料材质、剪裁、褶皱与蕾丝细节清晰真实，衣物贴合身体曲线但不变形；保留原有的脸、发型、体型比例、姿势、光影方向和背景，氛围暧昧克制",
      negative: NSFW_NEG + ", 廉价塑料质感, 廉价cosplay感, 衣服穿插, 身材变形, 多个人物, 换脸, 裸露过度, 泳装变形, 布料穿插, 版型错乱, 布料僵硬, 刺绣糊成一团, 过曝",
      fill: {
        label: "换成什么服装", placeholder: "例如：红色蕾丝睡裙 / 黑色皮衣 / 泳池边的白色比基尼",
        default: "黑色蕾丝内衣套装",
        chips: [
          "黑色蕾丝内衣套装",
          "白色蕾丝内衣套装",
          "黑色比基尼，泳装面料有光泽，皮肤带细小水珠",
          "白色连体泳衣，高叉剪裁贴合身形",
          "蕾丝女仆装，缎带与荷叶边细节",
          "护士服，开襟与蕾丝边",
          "兔女郎装，连体剪裁与腰封",
          "JK 水手服，百褶裙与领结",
          "真丝吊带睡裙，面料垂坠，暖调床头光",
          "白色棉质睡袍，宽松居家",
          "白色婚纱，缎面刺绣与裙摆层次",
          "开叉旗袍，修身剪裁与开衩",
          "黑色晚礼服，丝绒光泽与垂坠感"
        ]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 泳装 / 制服 / 睡衣 / 礼服都收在这一张里（快捷词直接选，也可以自己写，想连场景一起换就补一句「…，泳池边」）；只改穿着状态用「半脱·滑落」「湿身衣物」，材质特写用「丝袜质感」"
    },
    {
      id: "nsfw_stocking", view: "nsfw", cat: "outfit", label: "丝袜质感", icon: "🧦", desc: "腿部与网纱特写", mode: "edit",
      prompt: "重点刻画腿部与丝袜质感：细腻的网纱纹理、贴合皮肤的透光感、柔和的侧逆光勾出腿部轮廓，背景保持简洁；保留整体构图与人物特征",
      negative: NSFW_NEG + ", 网纹错乱, 腿部变形, 多余肢体",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 强调材质与光"
    },
    {
      id: "nsfw_slip", view: "nsfw", cat: "outfit", label: "半脱·滑落", icon: "👚", desc: "肩带滑落 / 衣襟半敞", mode: "edit",
      prompt: "让画面里的衣物呈现自然的半脱状态：{fill}，布料松垮地挂着，露出肩线、锁骨或腰侧，褶皱与滑落的走向符合重力，衣物边缘有被拉开的痕迹；保留人物的脸、发型、体型比例、姿势和背景，光影过渡自然",
      negative: NSFW_NEG + ", 布料穿模, 变形, 不自然的堆叠, 换脸, 身材失调, 低质量",
      fill: {
        label: "怎么脱", placeholder: "例如：肩带滑落一侧 / 衬衫扣子开了几颗",
        default: "肩带滑落一侧",
        chips: ["肩带滑落一侧", "衬衫扣子敞开几颗", "外衣滑到手臂上", "睡袍从肩膀落下", "裙子拉链拉开一半"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 和「更换服装」的区别：这里不换衣服，只改穿着状态"
    },
    {
      id: "nsfw_wetclothes", view: "nsfw", cat: "outfit", label: "湿身衣物", icon: "🫧", desc: "湿透布料 · 贴合水痕", mode: "edit",
      prompt: "把人物的衣物打湿：{fill}，湿透的布料贴合身体轮廓、颜色变深并出现自然的水痕与半透明感，皮肤上有水珠，光在湿布上形成高光；保留原有的脸、发型、体型比例、姿势和背景",
      negative: NSFW_NEG + ", 布料穿模, 水痕位置错乱, 塑料质感, 变形, 换脸, 过曝",
      fill: {
        label: "哪件衣服湿了", placeholder: "例如：白色衬衫湿透",
        default: "白色衬衫湿透",
        chips: ["白色衬衫湿透", "泳衣刚出水", "丝质连衣裙湿水", "背心被水打湿", "薄纱上衣湿透"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 只改衣物状态；要连场景一起湿用「湿身浴室」"
    },

    /* ---------- NSFW · 配饰 ---------- */
    {
      id: "nsfw_accessory", view: "nsfw", cat: "accessory", label: "配饰", icon: "🧤", desc: "项圈 / 吊带袜 / 腿环", mode: "edit",
      prompt: "给人物加上{fill}：皮革、蕾丝或金属的质感与反光真实，佩戴位置贴合身体与衣物，松紧自然、有轻微压痕，与整体造型协调；其余部分（脸、发型、服装、姿势、光影、背景）保持不变",
      negative: NSFW_NEG + ", 悬浮的配饰, 穿模, 金属发黑, 位置错乱, 变形, 换脸, 低质量",
      fill: {
        label: "加什么配饰", placeholder: "例如：黑色皮质项圈 / 吊带袜",
        default: "黑色皮质项圈",
        chips: ["黑色皮质项圈", "吊带袜", "蕾丝长手套", "大腿腿环", "珍珠耳饰", "皮革束带", "细链腰带"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 一次加一件最稳；要加两件就在框里写「项圈，吊带袜」"
    },

    /* ---------- NSFW · 身体类 ---------- */
    {
      id: "nsfw_nude", view: "nsfw", cat: "body", label: "裸体", icon: "🔥", desc: "全裸人体 · 柔光", mode: "edit",
      prompt: "把人物变成完全裸体的成年人体：去掉全部衣物，呈现自然真实的肌肤与身体曲线（锁骨、胸部、腰腹、腿部线条），保留原有的脸、发型、体型比例、姿势和背景；用柔和的窗光/自然光塑造身体轮廓，肤色统一干净，粉嫩的乳头和完整的阴部构造。构图完整不裁切",
      negative: NSFW_NEG + ", 衣物残留, 内衣痕迹, 畸形身材, 错误解剖, 多余肢体, 三只手, 融合的手臂, 塑料皮肤, 过度磨皮, 直白的性器官特写, 血色异常",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 全裸，柔光塑形"
    },
    {
      id: "nsfw_chest_up", view: "nsfw", cat: "body", label: "胸部变大", icon: "⏫", desc: "按罩杯变大 · C→K", mode: "edit",
      prompt: "把成年女性人物的胸部调整为 {fill}（明显比现在更大）：按目标罩杯对应的体积档位放大，字母档位越大体积越大；与肩宽、腰线、身高保持协调，衣物随之撑起并出现真实褶皱；保留脸、发型、姿势、光线和背景，人体结构必须正确",
      negative: NSFW_NEG + ", 变形, 比例失调, 衣服穿插, 解剖错误, 塑料质感, 硅胶感, 假体轮廓, 左右不对称, 下垂过度, 八字分开",
      fill: {
        label: "目标罩杯", placeholder: "例如：H 罩杯 / 特大（再大一号）",
        default: "D 罩杯",
        chips: ["C 罩杯", "D 罩杯", "E 罩杯", "F 罩杯", "G 罩杯", "H 罩杯", "I 罩杯", "J 罩杯", "K 罩杯"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年体型 · C→K 九档，字母越大越夸张；想更极端就分两步（先 G 再 K），模型比一步到位听话得多"
    },
    {
      id: "nsfw_chest_down", view: "nsfw", cat: "body", label: "胸部缩小", icon: "⏬", desc: "按罩杯缩小 · 成年体型", mode: "edit",
      prompt: "把成年女性人物的胸部调整为 {fill}（比现在更小）：体积减小但仍是成年女性的体型，与肩宽、腰线比例协调，衣物随之贴合；保留脸、发型、姿势、光线和背景，人体结构必须正确",
      negative: NSFW_NEG + ", 儿童体型, 幼态, 变形, 比例失调, 解剖错误, 凹陷畸形, 凹陷变形",
      fill: {
        label: "目标罩杯", placeholder: "例如：B 罩杯",
        default: "B 罩杯",
        chips: ["A 罩杯", "B 罩杯", "C 罩杯"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年体型 · 选目标罩杯（A→C）；幼态/儿童体型已在负面词里排掉"
    },
    {
      id: "nsfw_figure", view: "nsfw", cat: "body", label: "体型调整", icon: "📏", desc: "线条 / 比例 · 成年体型", mode: "edit",
      prompt: "把人物的体型调整为{fill}：肩宽、腰线、臀线与腿部比例随之调整，整体比例协调自然，仍然是成年人体；保留原有的脸、发型、姿势、光影和背景，人体结构必须正确",
      negative: NSFW_NEG + ", 比例失调, 变形, 错误解剖, 儿童体型, 幼态, 塑料质感, 衣服穿插",
      fill: {
        label: "什么体型", placeholder: "例如：纤细匀称 / 丰满曲线",
        default: "纤细匀称",
        chips: ["纤细匀称", "标准比例", "丰满曲线", "运动型身材", "高挑长腿"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年体型 · 只调整体比例；要单独调某个部位用「局部修形」更准"
    },
    {
      id: "nsfw_abs", view: "nsfw", cat: "body", label: "腹部线条", icon: "🏋️", desc: "马甲线 / 腹肌", mode: "edit",
      prompt: "强化人物的腹部线条：{fill}，肌肉的起伏与阴影自然，皮肤质感真实，与整体体型和光线方向一致；保留原有的脸、发型、服装、姿势和背景",
      negative: NSFW_NEG + ", 夸张的肌肉, 阴影错乱, 身材变形, 解剖错误, 换脸",
      fill: {
        label: "腹部线条", placeholder: "例如：马甲线 / 清晰的腹肌",
        default: "马甲线",
        chips: ["马甲线", "柔和平坦的腹部", "清晰的腹肌", "人鱼线"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 光从侧面打过来时线条最明显"
    },
    {
      id: "nsfw_hips", view: "nsfw", cat: "body", label: "臀部线条", icon: "🍑", desc: "臀腿曲线 · 光影塑形", mode: "edit",
      prompt: "强化人物的臀部与大腿线条：{fill}，曲线与光影自然，衣物随之贴合出现真实褶皱，体型比例协调；保留原有的脸、发型、姿势、光线和背景",
      negative: NSFW_NEG + ", 比例失调, 变形, 错误解剖, 衣服穿插, 换脸, 低质量",
      fill: {
        label: "什么线条", placeholder: "例如：圆润的臀部曲线",
        default: "圆润的臀部曲线",
        chips: ["圆润的臀部曲线", "紧实的臀部线条", "修长的大腿线条", "腰臀比更明显"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 侧后方视角最容易表现出曲线"
    },

    /* ---------- NSFW · 肤质 ---------- */
    {
      id: "nsfw_oil", view: "nsfw", cat: "skin", label: "身体抹油", icon: "✨", desc: "油亮高光 · 立体光影", mode: "edit",
      prompt: "给人物裸露或半裸露的皮肤加上涂抹油后的质感：均匀细腻的高光反射、油膜过渡自然，锁骨、肩背、关节和腰侧的光泽更明显，光影层次更立体；保留人物特征、姿势和背景，不改变体型与服装",
      negative: NSFW_NEG + ", 塑料反光, 油腻污渍, 肤色不均, 蜡像感, 汗液过多, 变形",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 高光质感；和「湿身浴室」的区别是不带场景与雾气"
    },
    {
      id: "nsfw_skin_tone", view: "nsfw", cat: "skin", label: "肤色", icon: "🍫", desc: "冷白 / 小麦 / 古铜", mode: "edit",
      prompt: "把人物的肤色调整为{fill}：色调过渡自然，保留细微的肤质纹理与毛孔，与画面光线的色温保持一致；其余内容（脸、发型、服装、姿势、背景）不变",
      negative: NSFW_NEG + ", 肤色斑驳, 色块断层, 塑料皮肤, 过曝, 换脸, 变形",
      fill: {
        label: "什么肤色", placeholder: "例如：小麦色 / 冷白皮",
        default: "自然象牙色",
        chips: ["冷白皮", "自然象牙色", "小麦色", "古铜色", "蜜糖色"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 换肤色会连带影响环境光的反射，光影会跟着微调"
    },
    {
      id: "nsfw_sweat", view: "nsfw", cat: "skin", label: "汗水质感", icon: "💦", desc: "汗珠 + 湿润高光", mode: "edit",
      prompt: "给人物加上出汗的质感：额头、颈侧、锁骨与胸口有细微的汗珠，皮肤因湿润而泛着柔和的高光，发丝略微贴在脸颊与颈侧；保留原有的脸、发型、服装、姿势和背景，不改变体型",
      negative: NSFW_NEG + ", 汗液成片, 油腻污渍, 塑料反光, 换脸, 变形, 低质量",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 和「身体抹油」的区别：汗水是散的细珠，油光是整片的高光"
    },
    {
      id: "nsfw_tan", view: "nsfw", cat: "skin", label: "晒痕", icon: "🌤", desc: "泳装 tan line", mode: "edit",
      prompt: "给人物加上泳装晒痕：{fill}，晒痕边缘有自然柔和的过渡与轻微肤色差异，皮肤质感真实，与环境光线协调；保留原有的脸、发型、体型比例、姿势、光影和背景",
      negative: NSFW_NEG + ", 晒痕边界生硬, 色块断层, 肤色斑驳, 换脸, 变形",
      fill: {
        label: "什么晒痕", placeholder: "例如：比基尼晒痕",
        default: "比基尼晒痕",
        chips: ["比基尼晒痕", "吊带背心晒痕", "短裤晒痕", "一字肩晒痕"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 晒痕要和画面主光方向一致才不假"
    },
    {
      id: "nsfw_tattoo", view: "nsfw", cat: "skin", label: "纹身", icon: "🖋️", desc: "花臂 / 腰侧 / 后背小图案", mode: "edit",
      prompt: "在人物身体上添加{fill}：线条清晰、深浅一致，贴合皮肤的起伏与弧度，边缘自然融入皮肤，随光线产生细微的明暗变化；不改变人物特征、姿势与画面构图",
      negative: NSFW_NEG + ", 纹身浮在表面, 图案断裂, 边缘毛糙, 刺青色, 换脸, 变形, 低质量",
      fill: {
        label: "什么纹身", placeholder: "例如：手臂花臂 / 腰侧小图案",
        default: "腰侧小型纹身",
        chips: ["手臂花臂纹身", "腰侧小型纹身", "后背蝴蝶纹身", "锁骨细线纹身", "大腿环绕纹身"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 整身加纹身容易糊，要精准就配合「局部纹身」框选来画"
    },

    /* ---------- NSFW · 表情 ---------- */
    {
      id: "nsfw_expression", view: "nsfw", cat: "expression", label: "妩媚表情", icon: "😏", desc: "只改神情", mode: "edit",
      prompt: "让人物露出媚惑而自然的神情：半眯的眼睛、微微张开的唇、脸颊淡淡泛红，眼神看向镜头；脸型、发型、服装、姿势和背景都保持不变",
      negative: NSFW_NEG + ", 夸张表情, 歪脸, 阴森, 眼睛变形",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 只改表情，其它不动"
    },
    {
      id: "nsfw_face", view: "nsfw", cat: "expression", label: "换表情", icon: "😳", desc: "娇羞 / 迷离 / 挑衅 / 回眸", mode: "edit",
      prompt: "让人物露出{fill}的神情：眼神、眼型、眉毛与嘴角的细微变化自然，情绪传达准确；脸型、发型、服装、姿势、光线和背景都保持不变",
      negative: NSFW_NEG + ", 夸张表情, 歪脸, 五官变形, 眼睛变形, 换脸, 低质量",
      fill: {
        label: "什么表情", placeholder: "例如：娇羞脸红 / 眼神迷离",
        default: "娇羞脸红",
        chips: ["娇羞脸红", "眼神迷离", "挑衅的坏笑", "有些喘的样子", "回眸媚眼", "轻咬下唇", "闭眼仰头"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 只改神情；想连视线一起改，就把「看着镜头」也写进框里"
    },
    {
      id: "nsfw_ahegao", view: "nsfw", cat: "expression", label: "高潮脸", icon: "😵", desc: "失神 · 晕红 · 舌尖外露", mode: "edit",
      prompt: "让人物的表情变成高潮时的失神状态：眼睛微微上翻、视线失焦没有焦点，脸颊、耳根和脖子泛红发烫，眉毛轻轻皱起，嘴唇张开、舌尖微微露出唇边，呼吸急促的样子，额头与鬓角带着薄汗；脸型、发型、服装、姿势、光线和背景都保持不变",
      negative: NSFW_NEG + ", 表情扭曲到变形, 眼睛翻白过度, 只有眼白, 舌头比例失真, 五官错位, 脸部崩坏, 口水过多, 换脸, 低质量",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 只改神情。翻眼和舌头是最容易崩的两处，不满意先换种子再改提示词"
    },

    /* ---------- NSFW · 场景光线 ---------- */
    {
      id: "nsfw_wet", view: "nsfw", cat: "scene", label: "湿身浴室", icon: "💧", desc: "水汽 + 皮肤高光", mode: "edit",
      prompt: "把画面改成浴室湿身氛围：弥漫的水汽、湿润的皮肤高光与水珠细节、湿发贴在颈侧，光线柔和偏冷，人物姿态放松；保留人物特征，氛围暧昧但不直白",
      negative: NSFW_NEG + ", 水汽过重看不清, 皮肤塑料感, 变形",
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 浴室湿身氛围"
    },
    {
      id: "nsfw_light", view: "nsfw", cat: "scene", label: "光线氛围", icon: "🕯️", desc: "暖调 / 霓虹 / 逆光 / 烛光", mode: "edit",
      prompt: "把画面的光线改成{fill}：主光方向明确，明暗对比与色温统一，皮肤和衣物上的高光与阴影随之变化，保留人物姿势、构图与五官特征",
      negative: NSFW_NEG + ", 光影错乱, 灰蒙蒙, 过曝, 死黑, 换脸, 变形",
      fill: {
        label: "什么光线", placeholder: "例如：暖调床头灯 / 清晨逆光",
        default: "暖调床头灯光",
        chips: ["暖调床头灯光", "霓虹夜店光", "清晨逆光", "烛光", "浴室冷调顶光", "月光", "窗边自然光"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 只改光不改场景，出图观感差异最大的一张卡"
    },
    {
      id: "nsfw_place", view: "nsfw", cat: "scene", label: "换场景", icon: "🛏️", desc: "卧室 / 浴室 / 泳池 / 办公室", mode: "edit",
      prompt: "把背景与场景换成{fill}：空间透视、材质与光线方向合理，人物与环境接触的位置有真实的阴影与反光，环境色温统一；人物本身的样貌、发型、服装和姿势保持不变",
      negative: NSFW_NEG + ", 透视错位, 光影不符, 悬浮, 边缘毛刺, 换脸, 变形",
      fill: {
        label: "换成什么场景", placeholder: "例如：卧室床边 / 泳池边",
        default: "卧室床边",
        chips: ["卧室床边", "浴室", "泳池边", "办公室", "车内夜景", "阳台夜景", "酒店落地窗前"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 和二次元的「更换背景」同一套思路，只是预置了成人向场景"
    },
    {
      id: "nsfw_angle", view: "nsfw", cat: "scene", label: "换视角", icon: "📐", desc: "低机位 / 俯视 / 背后", mode: "edit",
      prompt: "把镜头视角改成{fill}：透视关系随之调整，人物在画面中的比例与位置重新构图，光影与背景保持一致，仍然是同一个角色、同一套服装",
      negative: NSFW_NEG + ", 透视崩坏, 人体变形, 错误解剖, 多个人物, 换脸, 低质量",
      fill: {
        label: "什么视角", placeholder: "例如：低机位仰视 / 略微俯视",
        default: "低机位仰视",
        chips: ["低机位仰视", "略微俯视", "从背后看向镜头", "靠近的半身特写", "侧后方视角"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · ⚠ 换视角要重排整张图，成功率比别的卡低；失败就把参考分辨率降一档再试"
    },
    {
      id: "nsfw_mirror", view: "nsfw", cat: "scene", label: "镜面倒影", icon: "🪞", desc: "镜像 · 倒影对位", mode: "edit",
      prompt: "在画面里加入一面镜子：{fill}，镜中倒影与人物姿势、光线、构图严格对应，镜面有真实的反射与轻微的污渍质感；人物本身保持不变",
      negative: NSFW_NEG + ", 倒影对不上, 镜面穿模, 多余的人物, 透视错乱, 换脸, 变形",
      fill: {
        label: "什么镜子", placeholder: "例如：全身镜里的倒影",
        default: "全身镜里的倒影",
        chips: ["全身镜里的倒影", "半身镜中的侧影", "浴室雾镜上的倒影", "落地窗玻璃的反射"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024 },
      tip: "成年角色 · 最容易穿帮的是倒影对不上，出图后先看镜子里的姿势"
    },

    /* ---------- NSFW · 局部重绘 ---------- */
    {
      id: "nsfw_inpaint", view: "nsfw", cat: "local", label: "局部换内衣", icon: "✂️", desc: "框选后再改", mode: "inpaint", needsSelection: true,
      prompt: "把选区内的服装替换成黑色蕾丝内衣，边缘与周围皮肤自然过渡，光照方向与色温保持一致，不改变选区外内容",
      negative: NSFW_NEG + ", 接缝痕迹, 边缘硬切, 肤色不一致",
      params: { steps: 30, cfg: 1, resolution: 1024, feather: 8, expand: 4 },
      tip: "先在 PS 里框选服装区域，再点生成"
    },
    {
      id: "nsfw_crest", view: "nsfw", cat: "local", label: "淫纹", icon: "⚜️", desc: "下腹部纹章 · 皮肤透光", mode: "inpaint", needsSelection: true,
      prompt: "在选区内的皮肤上绘制一枚淫纹纹章：外形取自子宫的轮廓——中央是倒置的水滴形主体，上宽下窄、底部收圆，主体顶部两侧对称伸出两条细枝向外舒展卷曲，顶端各自收尖；整体是高度图案化、装饰化的纹样，线条纤细流畅、左右严格对称、粗细均匀，位于下腹部正中，边缘泛着柔和的红紫色微光，像从皮肤内部透出来一样，随身体的起伏与弧度自然贴合，图案与皮肤之间没有缝隙和影子；不改变周围皮肤的质感与画面其他内容，光照方向保持一致",
      negative: NSFW_NEG + ", 写实解剖图, 医学插图, 血肉质感, 立体器官, 图案外扩, 边缘毛糙, 图案不对称, 线条粗细不一, 皮肤破损, 切割痕迹, 接缝痕迹, 贴纸感, 浮在皮肤表面, 模糊",
      params: { steps: 30, cfg: 1, resolution: 1024, feather: 8, expand: 4 },
      tip: "成年角色 · 先在 PS 里框选下腹部再点生成。形状按子宫轮廓写死（水滴主体 + 两侧细枝卷曲），要改成火焰 / 几何就直接改这条的提示词"
    },
    {
      id: "nsfw_local_tattoo", view: "nsfw", cat: "local", label: "局部纹身", icon: "🖌️", desc: "框哪画哪 · 通用图案", mode: "inpaint", needsSelection: true,
      prompt: "在选区内的皮肤上绘制{fill}：线条清晰、深浅一致，贴合皮肤的起伏与弧度，边缘自然融入皮肤，随光线产生细微的明暗变化；不改变选区外的任何内容，光照方向保持一致",
      negative: NSFW_NEG + ", 纹身外扩, 图案溢出选区, 边缘毛糙, 浮在皮肤表面, 切割痕迹, 接缝痕迹, 模糊",
      fill: {
        label: "画什么图案", placeholder: "例如：小型藤蔓 / 几何细线",
        default: "小型藤蔓图案",
        chips: ["小型藤蔓图案", "几何细线图案", "一朵花的图案", "月亮与星星", "字母和短句", "蝴蝶"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024, feather: 8, expand: 4 },
      tip: "成年角色 · 框选范围比图案大一圈，留出羽化余量；图案不会跑出选区"
    },
    {
      id: "nsfw_local_sweat", view: "nsfw", cat: "local", label: "局部汗·油光", icon: "💧", desc: "只给这一块加质感", mode: "inpaint", needsSelection: true,
      prompt: "让选区内的皮肤出现{fill}：质感与周围皮肤的明暗自然衔接，光斑分布符合画面主光方向；不改变选区外的任何内容，也不改变体型与服装",
      negative: NSFW_NEG + ", 色块断层, 油腻污渍, 塑料反光, 边缘硬切, 接缝痕迹, 变形",
      fill: {
        label: "加什么质感", placeholder: "例如：细微的汗珠 / 油亮的高光",
        default: "细微的汗珠",
        chips: ["细微的汗珠", "油亮的高光", "湿润的水痕", "细密的鸡皮疙瘩"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024, feather: 10, expand: 6 },
      tip: "成年角色 · 比整身「抹油 / 汗水」自然得多，框锁骨、肩背、腰侧最见效"
    },
    {
      id: "nsfw_local_shape", view: "nsfw", cat: "local", label: "局部修形", icon: "✏️", desc: "腰线 / 腿型微调", mode: "inpaint", needsSelection: true,
      prompt: "微调选区内身体部位的线条：{fill}，形体变化自然、符合解剖结构，与周围部位的衔接平顺，皮肤质感与光影保持一致；不改变选区外的任何内容",
      negative: NSFW_NEG + ", 液化痕迹, 边缘扭曲, 解剖错误, 比例失调, 接缝痕迹, 变形",
      fill: {
        label: "怎么调", placeholder: "例如：腰线更收 / 腿部更修长",
        default: "腰线更收",
        chips: ["腰线更收", "腿部更修长", "肩颈线条更柔和", "下巴线条更清晰", "手臂更纤细"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024, feather: 12, expand: 8 },
      tip: "成年角色 · 羽化给大一点（12/8），否则会出现「液化」那种扭曲边"
    },
    {
      id: "nsfw_local_makeup", view: "nsfw", cat: "local", label: "局部妆容", icon: "💄", desc: "唇色 / 眼妆 / 腮红", mode: "inpaint", needsSelection: true,
      prompt: "修改选区内的妆容：{fill}，颜色与整体肤色、光线协调，边缘自然过渡，不改变选区外内容",
      negative: NSFW_NEG + ", 颜色突兀, 妆容糊成一片, 边缘硬切, 皮肤质感丢失, 五官变形",
      fill: {
        label: "改什么妆", placeholder: "例如：更深的唇色 / 淡淡的眼妆",
        default: "更深的唇色",
        chips: ["更深的唇色", "水润的唇彩", "淡淡的眼妆", "自然的腮红", "眼角的微红", "闪亮的高光"]
      },
      params: { steps: 30, cfg: 1, resolution: 1024, feather: 8, expand: 4 },
      tip: "成年角色 · 框嘴唇、眼周或脸颊，别框整张脸"
    }
  ];

  function byView(view) {
    return LIST.filter(function (x) { return (x.view || "anime") === view; });
  }

  // 某个工坊的分类表（顺序 = 面板上的显示顺序）
  function cats(view) {
    return (CATS[view] || []).slice();
  }

  function get(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }

  global.StarsPresets = { list: LIST, cats: cats, byView: byView, get: get };
})(window);
