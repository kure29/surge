/*
文件名：nodeseek-auto.js
NodeSeek 智能获取 Cookie 和自动签到模块

智能逻辑：
1. 支持 Surge 模块参数配置
2. 只在 Cookie 失效时才自动获取
3. 优先使用配置的 Cookie，失效后才拦截获取
4. 避免频繁拦截和获取
5. 详细日志输出，便于问题排查

配置参数：
- cookie: 手动配置的 Cookie（可选）
- auto_refresh: 是否自动刷新 Cookie（默认开启）
- silent_mode: 静默模式（获取Cookie时不提醒）
- cron: 签到时间设置

作者：Assistant
*/

const $ = new Env('NodeSeek');

// 配置信息
const config = {
    domain: 'nodeseek.com',
    checkinUrl: 'https://www.nodeseek.com/api/attendance',
    userInfoUrl: 'https://www.nodeseek.com/api/user/info',
    cookieKey: 'nodeseek_cookie_stored',
    userInfoKey: 'nodeseek_userinfo',
    lastUpdateKey: 'nodeseek_cookie_time',
    lastCheckKey: 'nodeseek_last_check'
};

// 主函数
async function main() {
    $.log('🚀 [主函数] 开始执行 NodeSeek 脚本');
    
    try {
        // 获取模块参数
        $.log('📋 [主函数] 开始解析参数...');
        const args = parseArguments();
        
        // 判断执行环境
        if (typeof $request !== 'undefined') {
            $.log('🌐 [主函数] HTTP 请求环境，执行智能 Cookie 处理');
            await smartCookieHandler(args);
        } else {
            $.log('⏰ [主函数] Cron 定时任务环境，执行签到');
            await performCheckin(args);
        }
        
        $.log('✅ [主函数] 脚本执行完成');
    } catch (error) {
        $.log(`❌ [主函数] 执行出错: ${error}`);
    }
}

// 解析模块参数
function parseArguments() {
    $.log('🔧 [参数解析] 开始解析模块参数');
    
    const args = {
        cookie: '',
        auto_refresh: true,
        silent_mode: true,
        cron: '0 9 * * *'
    };
    
    $.log(`🔧 [参数解析] $argument 内容: "${$argument}"`);
    
    if (typeof $argument !== 'undefined' && $argument) {
        const pairs = $argument.split('&');
        $.log(`🔧 [参数解析] 分割后的参数对: ${JSON.stringify(pairs)}`);
        
        for (const pair of pairs) {
            const [key, value] = pair.split('=');
            if (key && value) {
                const decodedValue = decodeURIComponent(value);
                $.log(`🔧 [参数解析] 处理参数: ${key} = ${decodedValue}`);
                
                switch (key) {
                    case 'cookie':
                        args.cookie = decodedValue === '{{{cookie}}}' ? '' : decodedValue;
                        break;
                    case 'auto_refresh':
                        args.auto_refresh = decodedValue === 'true' || decodedValue === '{{{auto_refresh}}}';
                        break;
                    case 'silent_mode':
                        args.silent_mode = decodedValue === 'true' || decodedValue === '{{{silent_mode}}}';
                        break;
                    case 'cron':
                        args.cron = decodedValue === '{{{cron}}}' ? '0 9 * * *' : decodedValue;
                        break;
                }
            }
        }
    } else {
        $.log('🔧 [参数解析] $argument 为空，使用默认参数');
    }
    
    $.log(`📋 [参数解析] 最终参数 - Cookie: ${args.cookie ? '已配置(' + args.cookie.length + '字符)' : '未配置'}, 自动刷新: ${args.auto_refresh}, 静默模式: ${args.silent_mode}`);
    return args;
}

// 智能 Cookie 处理
async function smartCookieHandler(args) {
    $.log('🍪 [Cookie处理] 开始智能 Cookie 处理');
    
    try {
        // 检查 $request 对象
        if (!$request) {
            $.log('❌ [Cookie处理] $request 对象不存在');
            return;
        }
        
        const url = $request.url;
        const headers = $request.headers;
        
        $.log(`🌐 [Cookie处理] 当前访问URL: ${url}`);
        $.log(`🌐 [Cookie处理] 请求头信息: ${JSON.stringify(Object.keys(headers))}`);
        
        // 检查是否为 NodeSeek 域名
        if (!url.includes(config.domain)) {
            $.log(`❌ [Cookie处理] 非 NodeSeek 域名(${config.domain})，跳过处理`);
            return;
        }
        
        $.log('✅ [Cookie处理] 确认为 NodeSeek 域名，继续处理');
        
        // 检查是否需要获取 Cookie
        $.log('🔍 [Cookie处理] 开始检查是否需要获取 Cookie...');
        const needsCookie = await shouldGetCookie(args);
        
        if (!needsCookie) {
            $.log('✅ [Cookie处理] 检查完成，无需获取 Cookie');
            return;
        }
        
        $.log('📋 [Cookie处理] 需要获取 Cookie，检查请求中的 Cookie');
        
        // 获取当前请求的 Cookie
        const currentCookie = headers['Cookie'] || headers['cookie'] || '';
        if (!currentCookie) {
            $.log('⚠️ [Cookie处理] 当前请求中未检测到 Cookie');
            return;
        }
        
        $.log(`🍪 [Cookie处理] 检测到 Cookie(${currentCookie.length}字符)，开始验证和保存...`);
        const success = await saveCookie(currentCookie, args.silent_mode);
        
        if (success) {
            $.log('✅ [Cookie处理] Cookie 保存成功');
            // 根据静默模式决定是否发送通知
            if (!args.silent_mode) {
                const userInfo = JSON.parse($.getdata(config.userInfoKey) || '{}');
                $.msg('NodeSeek Cookie', '获取成功', `用户: ${userInfo.username || 'Unknown'}`);
            }
        } else {
            $.log('❌ [Cookie处理] Cookie 保存失败');
        }
        
    } catch (error) {
        $.log(`❌ [Cookie处理] 处理失败: ${error}`);
        $.log(`❌ [Cookie处理] 错误堆栈: ${error.stack}`);
    }
}

// 判断是否需要获取 Cookie
async function shouldGetCookie(args) {
    $.log('🔍 [检查逻辑] 开始评估 Cookie 状态');
    
    try {
        // 1. 检查频率限制 - 避免过于频繁的检查
        const lastCheck = $.getdata(config.lastCheckKey) || '0';
        const lastCheckTime = parseInt(lastCheck);
        const now = Date.now();
        const minutesSinceCheck = (now - lastCheckTime) / (1000 * 60);
        
        $.log(`⏱️ [检查逻辑] 上次检查时间: ${lastCheckTime > 0 ? new Date(lastCheckTime).toLocaleString() : '从未检查'}`);
        $.log(`⏱️ [检查逻辑] 距离上次检查: ${Math.round(minutesSinceCheck)} 分钟`);
        
        // 如果距离上次检查不到30分钟，且不是首次检查，跳过
        if (minutesSinceCheck < 30 && lastCheckTime > 0) {
            $.log(`⏱️ [检查逻辑] 距离上次检查仅 ${Math.round(minutesSinceCheck)} 分钟，跳过检查`);
            return false;
        }
        
        // 更新检查时间
        $.setdata(now.toString(), config.lastCheckKey);
        $.log('📝 [检查逻辑] 已更新检查时间戳');
        
        // 2. 获取当前有效的 Cookie
        let currentCookie = '';
        let cookieSource = '';
        
        // 优先使用模块配置的 Cookie
        if (args.cookie && args.cookie.trim()) {
            currentCookie = args.cookie.trim();
            cookieSource = '模块配置';
            $.log(`🔧 [检查逻辑] 使用模块配置的 Cookie (${currentCookie.length}字符)`);
        } else {
            // 使用存储的 Cookie
            currentCookie = $.getdata(config.cookieKey) || '';
            cookieSource = '本地存储';
            $.log(`💾 [检查逻辑] 使用存储的 Cookie (${currentCookie.length}字符)`);
        }
        
        // 3. 如果没有 Cookie，需要获取
        if (!currentCookie) {
            $.log('🆕 [检查逻辑] 未找到有效 Cookie，需要获取');
            return true;
        }
        
        $.log(`🍪 [检查逻辑] 当前 Cookie 来源: ${cookieSource}`);
        
        // 4. 验证 Cookie 是否仍然有效
        $.log('🔍 [检查逻辑] 开始验证当前 Cookie 有效性...');
        const isValid = await validateCookie(currentCookie);
        
        if (!isValid) {
            $.log('❌ [检查逻辑] 当前 Cookie 已失效');
            if (args.auto_refresh) {
                $.log('🔄 [检查逻辑] 自动刷新已启用，需要重新获取');
                return true;
            } else {
                $.log('🔒 [检查逻辑] 自动刷新已禁用，跳过获取');
                return false;
            }
        }
        
        $.log('✅ [检查逻辑] Cookie 验证通过，状态良好');
        return false;
        
    } catch (error) {
        $.log(`❌ [检查逻辑] 检查 Cookie 状态失败: ${error}`);
        $.log(`❌ [检查逻辑] 错误堆栈: ${error.stack}`);
        return args.auto_refresh;
    }
}

// 验证 Cookie 有效性
async function validateCookie(cookie) {
    $.log('🔍 [Cookie验证] 开始验证 Cookie 有效性');
    
    try {
        if (!cookie || cookie.length < 10) {
            $.log('❌ [Cookie验证] Cookie 为空或长度不足');
            return false;
        }
        
        $.log(`🔍 [Cookie验证] 发送验证请求到: ${config.userInfoUrl}`);
        
        const response = await $.http.get({
            url: config.userInfoUrl,
            headers: {
                'Cookie': cookie,
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://www.nodeseek.com/'
            },
            timeout: 10
        });
        
        $.log(`🔍 [Cookie验证] 响应状态码: ${response.status}`);
        
        if (response.body) {
            const bodyPreview = response.body.substring(0, 100);
            $.log(`🔍 [Cookie验证] 响应内容预览: ${bodyPreview}...`);
        }
        
        const isValid = response.status === 200;
        $.log(`🔍 [Cookie验证] 验证结果: ${isValid ? '✅ 有效' : '❌ 无效'}`);
        return isValid;
        
    } catch (error) {
        $.log(`⚠️ [Cookie验证] 验证失败: ${error}`);
        $.log(`⚠️ [Cookie验证] 错误堆栈: ${error.stack}`);
        return false;
    }
}

// 保存 Cookie
async function saveCookie(cookie, silentMode = true) {
    $.log('💾 [Cookie保存] 开始保存 Cookie');
    
    try {
        if (!cookie || !cookie.includes('nodeseek')) {
            $.log('⚠️ [Cookie保存] Cookie 格式不正确');
            return false;
        }
        
        // 验证新 Cookie 的有效性
        $.log('🔍 [Cookie保存] 验证新 Cookie 有效性...');
        const isValid = await validateCookie(cookie);
        
        if (!isValid) {
            $.log('❌ [Cookie保存] 新 Cookie 无效');
            // 根据静默模式决定是否发送通知
            if (!silentMode) {
                $.msg('NodeSeek Cookie', '获取失败', 'Cookie 无效，请确认已正确登录');
            }
            return false;
        }
        
        // 保存 Cookie 和时间戳
        $.setdata(cookie, config.cookieKey);
        $.setdata(Date.now().toString(), config.lastUpdateKey);
        $.setdata(Date.now().toString(), config.lastCheckKey);
        
        $.log('✅ [Cookie保存] Cookie 已成功保存');
        
        // 获取并保存用户信息
        const userInfo = await getUserInfo(cookie);
        if (userInfo) {
            $.setdata(JSON.stringify(userInfo), config.userInfoKey);
            $.log(`👤 [Cookie保存] 用户信息已保存: ${userInfo.username || 'Unknown'}`);
        }
        
        // 根据静默模式决定是否发送通知
        if (!silentMode) {
            if (userInfo) {
                $.msg('NodeSeek Cookie', '更新成功', `用户: ${userInfo.username || 'Unknown'}`);
            } else {
                $.msg('NodeSeek Cookie', '更新成功', '已保存最新登录状态');
            }
        } else {
            $.log('🔕 [Cookie保存] 静默模式：Cookie 已更新，无需通知');
        }
        
        return true;
        
    } catch (error) {
        $.log(`❌ [Cookie保存] 保存 Cookie 失败: ${error}`);
        $.log(`❌ [Cookie保存] 错误堆栈: ${error.stack}`);
        // 根据静默模式决定是否发送通知
        if (!silentMode) {
            $.msg('NodeSeek Cookie', '保存失败', error.toString());
        }
        return false;
    }
}

// 获取用户信息
async function getUserInfo(cookie) {
    $.log('👤 [用户信息] 开始获取用户信息');
    
    try {
        const response = await $.http.get({
            url: config.userInfoUrl,
            headers: {
                'Cookie': cookie,
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
                'Accept': 'application/json',
                'Referer': 'https://www.nodeseek.com/'
            },
            timeout: 10
        });
        
        if (response.status === 200) {
            try {
                const data = JSON.parse(response.body);
                const userInfo = {
                    username: data.username || data.name || data.user?.name,
                    id: data.id || data.user?.id,
                    email: data.email || data.user?.email
                };
                $.log(`👤 [用户信息] 获取成功: ${userInfo.username || 'Unknown'}`);
                return userInfo;
            } catch (e) {
                $.log('⚠️ [用户信息] 解析用户信息失败');
            }
        } else {
            $.log(`⚠️ [用户信息] 获取失败，状态码: ${response.status}`);
        }
        
        return null;
    } catch (error) {
        $.log(`⚠️ [用户信息] 获取用户信息失败: ${error}`);
        return null;
    }
}

// 执行签到
async function performCheckin(args) {
    try {
        $.log('🚀 [签到任务] 开始执行 NodeSeek 签到任务');
        
        // 获取 Cookie
        let cookie = '';
        
        // 优先使用模块配置的 Cookie
        if (args.cookie && args.cookie.trim()) {
            cookie = args.cookie.trim();
            $.log('🔧 [签到任务] 使用模块配置的 Cookie');
        } else {
            // 使用存储的 Cookie
            cookie = $.getdata(config.cookieKey) || '';
            $.log('💾 [签到任务] 使用存储的 Cookie');
        }
        
        if (!cookie) {
            $.log('❌ [签到任务] 未找到可用的 Cookie');
            $.msg('NodeSeek 签到', '失败', '请先配置 Cookie 或访问 NodeSeek 网站获取');
            return;
        }
        
        // 验证 Cookie 是否仍然有效
        const isValid = await validateCookie(cookie);
        if (!isValid) {
            $.log('❌ [签到任务] Cookie 已过期');
            
            if (args.auto_refresh) {
                $.msg('NodeSeek 签到', '失败', 'Cookie 已过期，请重新访问网站刷新');
                // 清除存储的过期 Cookie
                $.setdata('', config.cookieKey);
                $.setdata('', config.lastUpdateKey);
            } else {
                $.msg('NodeSeek 签到', '失败', 'Cookie 已过期，请在模块中更新 Cookie');
            }
            return;
        }
        
        $.log('🍪 [签到任务] Cookie 验证通过，开始签到');
        
        // 执行签到
        const result = await checkin(cookie);
        
        if (result.success) {
            $.log('✅ [签到任务] 签到成功');
            $.msg('NodeSeek 签到', '成功', result.message || '今日签到完成');
        } else {
            $.log('❌ [签到任务] 签到失败');
            $.msg('NodeSeek 签到', '失败', result.message || '签到过程中出现错误');
            
            // 如果是认证问题，清除 Cookie
            if (result.needReauth) {
                $.setdata('', config.cookieKey);
                $.setdata('', config.lastUpdateKey);
                $.log('🗑️ [签到任务] 已清除无效的 Cookie');
            }
        }
        
    } catch (error) {
        $.log(`❌ [签到任务] 签到任务执行出错: ${error}`);
        $.msg('NodeSeek 签到', '错误', error.toString());
    }
}

// 签到函数
async function checkin(cookie) {
    $.log('📮 [签到请求] 开始发送签到请求');
    
    return new Promise((resolve) => {
        const options = {
            url: config.checkinUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'Cookie': cookie,
                'Referer': 'https://www.nodeseek.com/',
                'Origin': 'https://www.nodeseek.com',
                'X-Requested-With': 'XMLHttpRequest'
            },
            method: 'POST',
            body: JSON.stringify({}),
            timeout: 15
        };

        $.http.post(options).then(response => {
            const { status, body } = response;
            
            try {
                $.log(`📝 [签到请求] 签到响应状态: ${status}`);
                
                let data = {};
                try {
                    data = JSON.parse(body);
                } catch (e) {
                    // HTML 响应处理
                    if (body.includes('签到成功') || body.includes('check-in successful')) {
                        resolve({ success: true, message: '签到成功' });
                        return;
                    } else if (body.includes('已签到') || body.includes('already checked')) {
                        resolve({ success: true, message: '今日已签到' });
                        return;
                    }
                }
                
                // JSON 响应处理
                if (status === 200) {
                    if (data.success === true || data.code === 0 || data.status === 'success') {
                        resolve({
                            success: true,
                            message: data.message || data.msg || '签到成功'
                        });
                    } else if (data.message && (data.message.includes('已签到') || data.message.includes('already'))) {
                        resolve({
                            success: true,
                            message: '今日已签到'
                        });
                    } else {
                        resolve({
                            success: false,
                            message: data.message || data.msg || data.error || '签到失败'
                        });
                    }
                } else if (status === 401 || status === 403) {
                    resolve({
                        success: false,
                        message: '登录状态已过期',
                        needReauth: true
                    });
                } else {
                    resolve({
                        success: false,
                        message: `HTTP ${status}: 请求失败`
                    });
                }
                
            } catch (parseError) {
                $.log(`❌ [签到请求] 解析签到响应失败: ${parseError}`);
                resolve({
                    success: false,
                    message: '响应解析失败'
                });
            }
        }).catch(error => {
            $.log(`❌ [签到请求] 签到请求失败: ${error}`);
            resolve({
                success: false,
                message: `网络请求失败: ${error}`
            });
        });
    });
}

// Surge 环境适配函数
function Env(name) {
    return {
        name,
        log: (...args) => {
            const message = args.join(' ');
            console.log(`[${name}] ${message}`);
        },
        msg: (title, subtitle, message) => {
            if (typeof $notification !== 'undefined') {
                $notification.post(title, subtitle, message);
            }
        },
        getdata: (key) => {
            if (typeof $persistentStore !== 'undefined') {
                return $persistentStore.read(key);
            }
            return null;
        },
        setdata: (value, key) => {
            if (typeof $persistentStore !== 'undefined') {
                return $persistentStore.write(value, key);
            }
            return false;
        },
        http: {
            get: (options) => {
                return new Promise((resolve, reject) => {
                    if (typeof $httpClient !== 'undefined') {
                        $httpClient.get(options, (error, response, data) => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve({
                                    status: response.status,
                                    headers: response.headers,
                                    body: data
                                });
                            }
                        });
                    } else {
                        reject('HTTP client not available');
                    }
                });
            },
            post: (options) => {
                return new Promise((resolve, reject) => {
                    if (typeof $httpClient !== 'undefined') {
                        $httpClient.post(options, (error, response, data) => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve({
                                    status: response.status,
                                    headers: response.headers,
                                    body: data
                                });
                            }
                        });
                    } else {
                        reject('HTTP client not available');
                    }
                });
            }
        },
        done: () => {
            if (typeof $done !== 'undefined') {
                $done();
            }
        }
    };
}

// 执行主函数
(async () => {
    console.log('🎬 [启动] NodeSeek 脚本开始执行');
    try {
        await main();
        console.log('🏁 [结束] NodeSeek 脚本执行完成');
    } catch (error) {
        console.log(`💥 [错误] NodeSeek 脚本执行失败: ${error}`);
        console.log(`💥 [错误] 错误堆栈: ${error.stack}`);
    } finally {
        $.done();
    }
})();
