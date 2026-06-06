![screenshot](./docs/screenshot.png)

# Robot Viewer

一个基于浏览器的机器人模型查看器，支持 `URDF`、`Xacro`、`MJCF`、`USD` 等模型格式。当前仓库在原项目基础上增加了一个面向动作库调试的功能：

- 导入 CSV 动作库
- 按时间轴播放动作
- 用可配置的映射文件把 `can_iface + motor_id` 映射到 URDF 关节
- OpenArm 遥操链路可视化验证：`Viewer` / `Sim` / `Live` 三种模式

原项目入口请见：
- https://github.com/fan-ziqi/robot_viewer

## 功能概览

- 机器人模型可视化：显示连杆、关节、碰撞体、惯量、质心、坐标轴
- 关节交互：拖动滑条实时改变关节角度
- 文件面板与结构树：浏览模型文件和关节层级
- 代码编辑器：直接在页面里修改模型文件后重载
- MuJoCo 支持：对 MJCF 模型做仿真
- 动作库播放：导入 CSV，选中动作后在模型上回放
- 动作映射配置：支持导入自定义映射 JSON，并可随时恢复默认规则
- OpenArm Sim 模式：订阅目标 `JointState`，驱动 URDF，并发布虚拟当前关节状态
- OpenArm Live 模式：订阅真实反馈 `JointState`，只做 URDF 可视化同步

## 运行方式

项目声明的包管理器是 `pnpm@9.0.0`：

```bash
cd robot_viewer_al
pnpm install
pnpm run dev
```

启动后打开页面：

```text
http://127.0.0.1:3000/
```

构建生产版本：

```bash
pnpm run build
```

构建产物会输出到 `dist/`。

## OpenArm 模式系统

顶部工具栏提供模式切换入口：

```text
Mode: Viewer | Sim | Live
```

### 你需要准备什么

使用 `Sim` / `Live` 前，需要准备：

1. 一个可加载的 URDF / Xacro / robot model，最好连同 meshes 目录一起加载。
2. 一个 rosbridge WebSocket，默认地址是 `ws://localhost:9090`。
3. 一个 `sensor_msgs/msg/JointState` 输入 topic。
4. 如果 topic 里的 joint name 和 URDF joint name 不一致，需要提供 joint mapping。

### Viewer

`Viewer` 是原有模型查看模式，保留文件面板、关节面板、动作库、结构树、代码编辑器等原有功能。

### Sim

`Sim` 是遥操仿真验证模式。切换到 `Sim` 后，原 Viewer 面板入口会隐藏，只显示 `Sim Panel`。

默认配置：

```text
ROS Bridge URL: ws://localhost:9090
Target JointState Topic: /openarm/target_joint_states
Sim Current JointState Publish Topic: /openarm/sim/joint_states
Current JointState Topic for IK: /openarm/current_joint_states
```

运行逻辑：

1. 先加载 URDF / robot model。
2. 进入 `Sim` 模式。
3. 在 `Sim Panel` 中连接 rosbridge。
4. 点击 `Start Simulation`。
5. Viewer 从当前模型可动关节生成虚拟 current joint state。
6. Viewer 订阅 `/openarm/target_joint_states`，收到目标关节后驱动 URDF。
7. Viewer 持续发布 `/openarm/sim/joint_states` 和 `/openarm/current_joint_states`。

第一版 `sim_joint_states` 与 `current_joint_states` 内容相同，都是当前 URDF 虚拟关节状态。

最短验证路径：

1. 切到 `Viewer`，加载 URDF 或模型目录。
2. 切到 `Sim`。
3. ROS 侧启动 rosbridge。
4. 网页点击 `Connect`。
5. 网页点击 `Start Simulation`。
6. 向 `/openarm/target_joint_states` 发布测试 `JointState`。

### Live

`Live` 是真实反馈可视化模式。切换到 `Live` 后，原 Viewer 面板入口会隐藏，只显示 `Live Panel`。

默认配置：

```text
ROS Bridge URL: ws://localhost:9090
Live JointState Topic: /openarm/live/joint_states
```

运行逻辑：

1. 先加载 URDF / robot model。
2. 进入 `Live` 模式。
3. 在 `Live Panel` 中连接 rosbridge。
4. 点击 `Start Live View`。
5. Viewer 订阅真实反馈 `JointState`，按 mapping 驱动 URDF。

`Live` 模式不会发布虚拟 current joint states，也不会发送任何机械臂控制命令。

最短验证路径：

1. 切到 `Viewer`，加载 URDF 或模型目录。
2. 切到 `Live`。
3. ROS 侧启动 rosbridge。
4. 网页点击 `Connect`。
5. 网页点击 `Start Live View`。
6. 向 `/openarm/live/joint_states` 发布测试或真实反馈 `JointState`。

### 安全边界

当前项目只做可视化和仿真状态发布：

- 不发送电机控制命令
- 不连接 CAN
- 不调用 OpenArm 电机 SDK
- UI 固定显示 `Arm Output: DISABLED`

## rosbridge 与 JointState

浏览器端通过 `roslibjs` 连接 rosbridge。ROS 侧需要先启动 rosbridge websocket，例如：

```bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

前端使用标准 roslib 类型字符串：

```text
sensor_msgs/JointState
```

消息字段：

```text
name[]      URDF 关节名
position[]  当前关节角，单位 rad
velocity[]  可为空
effort[]    可为空
```

### Joint Mapping

Sim / Live 面板的 mapping 支持两种写法。

字符串写法：

```json
{
  "name": "openarm-stream-default",
  "version": 1,
  "source": "joint_state",
  "mappings": {
    "source_joint_name": "urdf_joint_name"
  }
}
```

对象写法：

```json
{
  "name": "openarm-stream-default",
  "version": 1,
  "source": "joint_state",
  "mappings": {
    "source_joint_name": {
      "urdf_joint": "urdf_joint_name",
      "scale": 1.0,
      "offset": 0.0,
      "sign": 1
    }
  }
}
```

映射公式：

```text
urdf_value = sign * source_value * scale + offset
```

如果没有提供 mapping，则默认使用 `source_joint_name == urdf_joint_name`。

### ROS2 测试命令

把 `joint1` 替换成当前 URDF 中真实存在的可动关节名：

```bash
ros2 topic pub /openarm/target_joint_states sensor_msgs/msg/JointState "{
  header: {stamp: {sec: 0, nanosec: 0}, frame_id: ''},
  name: ['joint1'],
  position: [0.5],
  velocity: [],
  effort: []
}"
```

验证 Live 模式时，把 topic 改成：

```bash
ros2 topic pub /openarm/live/joint_states sensor_msgs/msg/JointState "{
  header: {stamp: {sec: 0, nanosec: 0}, frame_id: ''},
  name: ['joint1'],
  position: [0.5],
  velocity: [],
  effort: []
}"
```

### 常见状态说明

- `Load a URDF/model first`：还没有加载模型，先回到 `Viewer` 模式加载 URDF 或模型目录。
- `Connection: error`：前端没有连上 rosbridge。确认 ROS 侧已启动 rosbridge，URL 是否应该是 `ws://localhost:9090` 或 `ws://<ROS机器IP>:9090`。
- `Mapped Joint Count = 0`：收到消息了，但没有任何 JointState name 成功映射到当前模型关节。
- `Missing Joint Count > 0`：mapping 后的 URDF joint name 不存在，检查 mapping 或 URDF 关节名。
- 模型不动但连接正常：优先确认 `name[]` 和 `position[]` 长度一致、position 单位是 rad、topic 是否发到了当前面板配置的输入 topic。

## 基本使用流程

1. 启动开发服务器并打开页面
2. 导入机器人模型目录或模型文件
3. 打开 `Actions` 面板
4. 点击 `Import CSV` 导入动作库文件
5. 如果动作库的 `can_iface:motor_id` 与当前默认规则不一致，点击 `Import Mapping` 导入自定义映射 JSON
6. 选择动作并点击 `Play`
7. 如需确认内置规则，可点击 `View Default Rules`

## CSV 动作库文件定义

播放器读取的是按时间排序的关节动作表。当前解析器定义在 [ActionLibraryParser.js](./src/actions/ActionLibraryParser.js)。

### 表头

CSV 的前 5 列必须按下面的顺序出现：

```csv
frame,can_iface,motor_id,position_rad,elapsed_ms
```

第 6、7 列是可选列：

```csv
speed_rad_s,accel_rad_s2
```

因此一个完整表头通常写成：

```csv
frame,can_iface,motor_id,position_rad,elapsed_ms,speed_rad_s,accel_rad_s2
```

### 字段说明

| 字段名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame` | 整数 | 是 | 帧编号。相同 `frame` 的多行会合并成一个时刻的关节姿态。 |
| `can_iface` | 字符串 | 是 | 电机所属总线，如 `can2`、`can3`。 |
| `motor_id` | 整数 | 是 | 电机 ID。 |
| `position_rad` | 浮点数 | 是 | 目标关节角，单位是弧度。 |
| `elapsed_ms` | 整数 | 是 | 从动作开始到当前帧的累计时间，单位毫秒。 |
| `speed_rad_s` | 浮点数 | 否 | 速度字段。当前播放器会读取但不会用它驱动时间轴。 |
| `accel_rad_s2` | 浮点数 | 否 | 加速度字段。当前播放器会读取但不会用它驱动时间轴。 |

### 解析规则

- 相同 `frame` 的多行会合并为一个姿态帧
- 同一帧里每个关节只保留最后一次写入的值
- 某个关节如果在后续帧没有再次出现，会沿用上一帧的姿态
- 播放器使用 `elapsed_ms` 作为时间轴，并在相邻关键帧之间做线性插值
- 如果某一行找不到映射规则，该行会被记为 `unmapped`
- 如果某个映射后的关节名不在当前加载的 URDF 模型中，该关节会被记为 `missing model joint`

### 最小示例

```csv
frame,can_iface,motor_id,position_rad,elapsed_ms,speed_rad_s,accel_rad_s2
0,can2,3,0.000000,0,1.2,0.0
0,can2,4,0.000000,0,1.2,0.0
0,can2,5,0.000000,0,1.2,0.0
0,can2,6,0.000000,0,1.2,0.0
1,can2,3,0.350000,400,1.2,0.0
1,can2,4,-0.120000,400,1.2,0.0
1,can2,5,0.000000,400,1.2,0.0
1,can2,6,0.180000,400,1.2,0.0
2,can2,3,0.000000,800,1.2,0.0
2,can2,4,0.000000,800,1.2,0.0
2,can2,5,0.000000,800,1.2,0.0
2,can2,6,0.000000,800,1.2,0.0
```

### 生成动作库时的建议

- `frame` 建议从 `0` 开始连续编号
- `elapsed_ms` 必须单调不减，且建议使用累计时间而不是帧间隔
- 一个动作至少应包含一个中立帧和一个结束帧
- `position_rad` 要直接写入目标弧度，不要混用角度值
- 如果你的动作库已经包含速度和加速度列，保留即可；当前版本不会强依赖它们

## 关节映射配置文件

默认映射文件在：

```text
public/config/action-joint-mapping.json
```

它决定了 CSV 中的电机键如何映射到当前模型中的 URDF 关节名。

### JSON 结构

```json
{
  "name": "default",
  "version": 1,
  "description": "Default action-to-joint mapping used by the Actions panel.",
  "mappings": {
    "can2:3": "lw_shoulder_pitch",
    "can2:4": "lw_arm_roll"
  }
}
```

### 字段说明

| 字段名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | 字符串 | 否 | 这套映射的名称，会显示在 `Actions` 面板中。 |
| `version` | 数字 | 否 | 配置版本号，方便你自己管理。 |
| `description` | 字符串 | 否 | 一段描述文字，会显示在映射摘要区域。 |
| `mappings` | 对象 | 是 | 实际映射表。键是 `can_iface:motor_id`，值是 URDF 关节名。 |

### `mappings` 的写法

键的格式固定为：

```text
<can_iface>:<motor_id>
```

例如：

- `can2:3`
- `can3:16`
- `can1:5`

tips:can2:3 表示 can2 总线上的电机 ID 为 3 的关节
值必须是当前模型里真实存在的关节名，例如：

- `lw_shoulder_pitch`
- `rw_arm_roll`
- `head_yaw`




### 示例：双臂映射

```json
{
  "name": "upper-body",
  "version": 1,
  "description": "Upper body playback mapping.",
  "mappings": {
    "can2:3": "lw_shoulder_pitch",
    "can2:4": "lw_arm_roll",
    "can2:5": "lw_arm_yaw",
    "can2:6": "lw_elbow_pitch",
    "can3:13": "rw_shoulder_pitch",
    "can3:14": "rw_arm_roll",
    "can3:15": "rw_arm_yaw",
    "can3:16": "rw_elbow_pitch"
  }
}
```

### 当前默认动作库映射关系

当前项目自带的默认映射如下：

| 动作库键 | URDF 关节名 |
| --- | --- |
| `can2:3` | `lw_shoulder_pitch` |
| `can2:4` | `lw_arm_roll` |
| `can2:5` | `lw_arm_yaw` |
| `can2:6` | `lw_elbow_pitch` |
| `can3:13` | `rw_shoulder_pitch` |
| `can3:14` | `rw_arm_roll` |
| `can3:15` | `rw_arm_yaw` |
| `can3:16` | `rw_elbow_pitch` |
| `can1:3` | `lw_shoulder_pitch` |
| `can1:4` | `lw_arm_roll` |
| `can1:5` | `lw_arm_yaw` |
| `can1:6` | `lw_elbow_pitch` |
| `can1:13` | `rw_shoulder_pitch` |
| `can1:14` | `rw_arm_roll` |
| `can1:15` | `rw_arm_yaw` |
| `can1:16` | `rw_elbow_pitch` |

### 导入与覆盖规则

- `Import Mapping`：导入一份自定义 JSON 映射
- `Reset Default`：恢复到默认文件

导入自定义映射后：

- 已经导入过的动作 CSV 会自动重新解析
- 映射配置会保存在浏览器本地存储里
- 刷新页面后仍会继续使用上次导入的映射
- 如果当前还没有导入过自定义映射，点击 `Play` 时会先弹窗确认，确认后才会按默认映射播放

### 编写映射文件时的建议

- 先确认 URDF 里真实的 joint name，再写映射值
- 尽量保持一个电机只映射到一个关节
- 如果你维护多套机器人模型，建议为每套模型单独存一份 JSON
- 如果一行动作始终没有生效，优先检查：
  - `can_iface` 是否写对
  - `motor_id` 是否写对
  - 映射后的 joint name 是否存在于当前模型

## 与原项目的关系

这个仓库基于原作者的 Robot Viewer 扩展而来，保留了模型查看、编辑、仿真等原有能力，并增加了 CSV 动作库播放与映射配置功能。

原项目地址：
- https://github.com/fan-ziqi/robot_viewer

## License

本项目沿用 [Apache License 2.0](LICENSE)。
