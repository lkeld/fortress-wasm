export function nativeCallRouter(
    id: number,
    argsJson: string,
    cachedNativeData: any,
    workerInitTime: number
): string {
    try {
        // Enforce a strict payload size limit
        if (argsJson && argsJson.length > 4096) {
            return JSON.stringify({ error: "PayloadTooLarge" });
        }

        switch (id) {
            case 1: {
                return (cachedNativeData && cachedNativeData.webgl) || "";
            }
            case 2: {
                return (cachedNativeData && cachedNativeData.canvas) || "";
            }
            case 3: {
                return JSON.stringify((cachedNativeData && cachedNativeData.automation) || {});
            }
            case 4: {
                // Return stringified screen data. Copy original pattern or update existing cachedNativeData object
                const screenData = { ...((cachedNativeData && cachedNativeData.screen) || {}) };
                if (argsJson) {
                    const args = JSON.parse(argsJson);
                    if (Array.isArray(args) && args.length >= 2) {
                        if (typeof args[0] === 'number') {
                            screenData.width = args[0];
                            screenData.availWidth = args[0];
                            if (cachedNativeData && cachedNativeData.screen) {
                                cachedNativeData.screen.width = args[0];
                                cachedNativeData.screen.availWidth = args[0];
                            }
                        }
                        if (typeof args[1] === 'number') {
                            screenData.height = args[1];
                            screenData.availHeight = args[1];
                            if (cachedNativeData && cachedNativeData.screen) {
                                cachedNativeData.screen.height = args[1];
                                cachedNativeData.screen.availHeight = args[1];
                            }
                        }
                    }
                }
                return JSON.stringify(screenData);
            }
            case 1001: { // get_environment
                const hasNavigator = typeof navigator !== 'undefined';
                const webdriver = hasNavigator && typeof (navigator as any).webdriver !== 'undefined'
                    ? (navigator as any).webdriver
                    : false;
                const hardwareConcurrency = hasNavigator && typeof navigator.hardwareConcurrency === 'number'
                    ? navigator.hardwareConcurrency
                    : 4;
                const deviceMemory = hasNavigator && typeof (navigator as any).deviceMemory === 'number'
                    ? (navigator as any).deviceMemory
                    : 8;
                const languages = hasNavigator && Array.isArray(navigator.languages)
                    ? navigator.languages
                    : ['en-US', 'en'];
                const plugins_count = hasNavigator && navigator.plugins && typeof navigator.plugins.length === 'number'
                    ? navigator.plugins.length
                    : 0;

                return JSON.stringify({
                    webdriver,
                    hardwareConcurrency,
                    deviceMemory,
                    languages,
                    plugins_count
                });
            }
            case 1002: { // get_timing_delta
                const delta_ms = performance.now() - workerInitTime;
                return JSON.stringify({ delta_ms });
            }
            case 1003: { // get_webgl_info
                if (typeof OffscreenCanvas === 'undefined') {
                    return JSON.stringify({ supported: false });
                }
                try {
                    const canvas = new OffscreenCanvas(256, 256);
                    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                    if (!gl) {
                        return JSON.stringify({ supported: false });
                    }
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
                    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
                    const version = gl.getParameter(gl.VERSION);
                    const shadingLanguageVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
                    
                    return JSON.stringify({
                        supported: true,
                        vendor: String(vendor),
                        renderer: String(renderer),
                        version: String(version),
                        shadingLanguageVersion: String(shadingLanguageVersion)
                    });
                } catch (err) {
                    return JSON.stringify({ supported: false });
                }
            }
            case 1004: { // get_screen_metrics
                const scr = typeof screen !== 'undefined' ? screen : {} as any;
                const width = typeof scr.width === 'number' ? scr.width : 1920;
                const height = typeof scr.height === 'number' ? scr.height : 1080;
                const colorDepth = typeof scr.colorDepth === 'number' ? scr.colorDepth : 24;
                const pixelRatio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

                return JSON.stringify({
                    width,
                    height,
                    colorDepth,
                    pixelRatio
                });
            }
            case 9999: { // ping
                return JSON.stringify({
                    status: "ok",
                    timestamp: Date.now()
                });
            }
            default:
                return "";
        }
    } catch (err: any) {
        return JSON.stringify({
            error: "HandlerError",
            message: err.message || String(err)
        });
    }
}
