# 消息队列选型：RabbitMQ 与 Kafka 使用场景

本文给出 RabbitMQ 与 Kafka 的适用场景、选型口诀，以及在本项目中的落地建议。

## 核心区别

RabbitMQ 是「智能路由的任务队列」，Kafka 是「高吞吐的持久事件流」。前者重在把活儿派出去干完，后者重在把事实广播出去、留档、供多方取用。

## RabbitMQ 适用场景

消息是「活儿」，一条消息触发一次业务处理：

- 后台异步任务：发邮件、生成报表、导出 Excel、调用第三方接口
- 服务间业务解耦：下单后通知库存、支付回调后更新订单状态
- 复杂路由分发：按 header/topic 把消息精确投给某几个队列
- 精细的消费控制：手动 ack、失败重试、死信队列、限流、RPC 请求-应答
- 中等消息量（秒级千条以内），单条消息有明确的业务语义，消费一次即完成

## Kafka 适用场景

消息是「数据」，一份数据被反复消费和回放：

- 高吞吐流式数据：埋点上报、日志采集、IoT 遥测、行情推送（万级/秒起）
- 事件溯源与数据管道：业务变更事件进数仓、CDC 同步、实时数仓/大屏
- 一写多读：同一份数据，订单组、风控组、数据组各自独立消费，互不影响
- 需要回放：消费者宕机或新业务上线，可从历史 offset 重新消费
- 流处理：配合 Flink / Kafka Streams 做实时计算

## 选型口诀

要「把活派出去干完」选 RabbitMQ；要「把事实广播出去、留档、多方各取所需」选 Kafka。两个都想要的场景很常见——业务指令走 RabbitMQ，业务产生的数据事件走 Kafka。

## 本项目落地建议

| 需求 | 选型 |
| --- | --- |
| 纯后台任务（邮件、报表、AI 长任务） | BullMQ（基于 Redis，已引入），不必再上 RabbitMQ |
| 跨服务业务解耦、任务分发 | RabbitMQ |
| 埋点、日志、事件进数仓 | Kafka |

## 依赖安装

```bash
# RabbitMQ + Kafka（NestJS 官方传输层 @nestjs/microservices 同时支持两者）
pnpm add @nestjs/microservices amqplib amqp-connection-manager kafkajs
```

| 包 | 作用 |
| --- | --- |
| `@nestjs/microservices` | Nest 官方传输层，RabbitMQ 走 `Transport.RMQ`，Kafka 走 `Transport.KAFKA` |
| `amqplib` | RabbitMQ 驱动（2.x 自带类型，无需 `@types/amqplib`） |
| `amqp-connection-manager` | RabbitMQ 断线自动重连、多节点轮询（生产环境建议带上） |
| `kafkajs` | Kafka 客户端 |
