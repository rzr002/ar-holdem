# 实现证据

- 原项目路径：terminal-holdem。
- Hand是纯规则状态机，observation(seat)已提供JSON安全隔离视图。
- CodexAgent/ResilientAgent可直接复用，模型失败不会自动替换本地策略。
- 旧项目没有HTTP接口，需独立适配层。
- 旧92项测试通过（explorer检查）；无第三方Python依赖。
- 本机未找到Lens Studio.app。
- 官方SPECS模板包含.esproj、Assets、Packages，不能用空文件冒充真实工程。
- 官方InternetModule提供fetch；HTTP需Experimental APIs且不可发布，HTTPS可发布；预览需Device Type Override=Spectacles。
- 官方链接：https://developers.snap.com/spectacles/about-spectacles-features/apis/internet-access
- 官方模板：https://github.com/specs-devs/samples/tree/main/Specs%20Base%20Template

## 设计
空间牌桌采用深色牌室、翡翠色桌面、象牙色大卡牌。三人桌先跑完整流程，模型思考状态清楚，底牌保护明确；信息与操作适合随后迁入原生Lens。

## 基础设施验证
- Lens Studio 5.23.2.26081320 ARM64通过磁盘映像、Snap签名与Apple公证检查；官方工程升级后编译和本机预览通过。
- 仅为Lens Studio进程设置现有代理后，官方Asset Library恢复，重载插件后MCP提供38项工具。ListAllPanels与ExecuteEditorCode只读调用均成功，工程路径匹配ARHoldem。
- 唯一未完成的官方CLAD就绪检查为本人登录：首次isAuthorized=false，已向用户提出登录步骤，不调用authorize()。
- 赛事资源页仍要求Lens Studio 5.22+，并明确列出5.23.2为CLAD登录问题的兼容回退版本：https://learn-specs.devpost.com/resources 。当前不必为基础设施升级到5.24.1。
