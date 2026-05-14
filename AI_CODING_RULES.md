一、总体原则

AI 在生成代码时必须遵守以下原则：

必须遵循项目技术栈

必须遵循目录结构

必须生成完整可运行代码

禁止生成伪代码

必须添加必要注释

必须遵循统一命名规范

优先生成可维护代码

二、技术栈规范
前端

必须使用：

Vue.js

TypeScript

Ant Design Vue

Vite

Pinia

Vue Router

Axios

禁止：

Vue2

Options API

jQuery

后端

必须使用：

Java 17+

Spring Boot

Spring Cloud

Nacos

MyBatis-Plus

MySQL

Redis

三、项目结构规范
前端结构
frontend
 ├─ src
 │ ├─ api
 │ ├─ components
 │ ├─ views
 │ ├─ router
 │ ├─ store
 │ ├─ hooks
 │ ├─ utils
 │ ├─ types
 │ └─ assets

说明：

目录 用途
api 接口请求
views 页面
components 组件
store Pinia状态管理
hooks 组合式函数
后端结构
backend
 ├─ gateway
 ├─ auth-service
 ├─ user-service
 ├─ order-service
 └─ common

单个服务结构：

service-name
 ├─ controller
 ├─ service
 ├─ service.impl
 ├─ mapper
 ├─ entity
 ├─ dto
 ├─ vo
 ├─ config
 ├─ constant
 └─ util
四、命名规范
Java类命名
类型 规则
Controller UserController
Service UserService
ServiceImpl UserServiceImpl
Mapper UserMapper
Entity User
DTO UserDTO
VO UserVO
数据库命名

表名：

snake_case

示例：

sys_user
sys_role
sys_permission

字段：

create_time
update_time
deleted
API命名

RESTful 风格：

GET /user/list
GET /user/{id}
POST /user/create
PUT /user/update
DELETE /user/{id}
五、前端开发规则
1 必须使用 Composition API

示例：

<script setup lang="ts">
import { ref } from 'vue'

const loading = ref(false)
</script>
2 API统一管理

所有请求必须放在：

src/api

示例：

import request from '@/utils/request'

export function getUserList() {
 return request.get('/user/list')
}

禁止：

组件内直接写 axios。

3 页面结构

页面必须在：

views/模块名

示例：

views
 └─ user
 ├─ UserList.vue
 └─ UserEdit.vue
4 UI规范

所有 UI 必须使用：

Ant Design Vue

优先组件：

Table

Form

Modal

Drawer

Pagination

六、后端开发规则
1 Controller 规范

Controller 只做：

参数接收

调用 Service

返回结果

禁止写业务逻辑。

示例：

@RestController
@RequestMapping("/user")
public class UserController {

 @Autowired
 private UserService userService;

}
2 Service规范

业务逻辑必须在：

service

接口：

UserService

实现：

UserServiceImpl
3 Mapper规范

使用：

MyBatis-Plus

示例：

@Mapper
public interface UserMapper extends BaseMapper<User> {

}
七、数据库操作规范

必须使用：

LambdaQueryWrapper

示例：

LambdaQueryWrapper<User> wrapper = new LambdaQueryWrapper<>();
wrapper.eq(User::getUsername, username);

userMapper.selectList(wrapper);
八、返回结果规范

所有接口统一返回：

{
 "code":200,
 "message":"success",
 "data":{}
}

Java封装：

public class Result<T> {

 private Integer code;
 private String message;
 private T data;

}
九、异常处理规范

必须使用：

全局异常处理

示例：

@RestControllerAdvice
public class GlobalExceptionHandler {

}
十、日志规范

使用：

@Slf4j

禁止：

System.out.println
十一、微服务规范

使用：

Spring Cloud

服务注册：

Nacos

示例：

spring:
 cloud:
 nacos:
 discovery:
 server-addr: localhost:8848
十二、安全规范

使用：

Spring Security + JWT

统一在：

gateway

进行鉴权。

十三、AI代码生成规则

AI生成代码必须：

按目录结构生成文件

保持代码分层

使用统一返回 Result

使用 MyBatisPlus

使用 Ant Design Vue

遵循 RESTful API

添加注释

保持代码简洁

十四、AI自动生成 CRUD 规则

当用户要求 CRUD 时：

AI必须生成：

后端：

Entity
Mapper
Service
ServiceImpl
Controller

前端：

API
List页面
Edit页面

页面必须包含：

Table

新增

编辑

删除

分页

十五、代码质量要求

AI生成代码必须：

可编译

可运行

无明显语法错误

避免重复代码

使用最佳实践

十六、生成代码优先级

AI生成代码时优先考虑：

1️⃣ 可维护性
2️⃣ 可读性
3️⃣ 扩展性

而不是最少代码。

十七、AI开发流程

AI在开发功能时应按顺序：

创建数据库表

创建 Entity

创建 Mapper

创建 Service

创建 Controller

创建前端 API

创建页面

💡 强烈建议再加一个 AI Prompt 文件

AI_SYSTEM_PROMPT.md

用于强制 AI 行为。

例如：

你是一个企业级Java全栈工程师，
必须遵守 AI_CODING_RULES.md，
生成代码必须符合项目架构。