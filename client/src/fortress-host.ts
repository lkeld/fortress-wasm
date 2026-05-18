export class FortressHost {
    private wasmInstance: WebAssembly.Instance | null = null;
    
    // Telemetry storage to ensure stable returns during the session
    private webglInfo: string | null = null;
    private canvasHash: string | null = null;

    /**
     * Instantiates the WebAssembly module with our environment bindings.
     */
    public async load(wasmBytes: ArrayBuffer) {
        const importObject = {
            env: {
                native_call: (id: number, argsPtr: number, argsLen: number): number => {
                    // For a real production host, we'd read string from memory
                    // Since our Rust execute() wrapper is doing string passing differently right now, 
                    // we'll simulate the native_call handling directly.
                    return 0; 
                }
            }
        };

        const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
        this.wasmInstance = instance;
    }

    /**
     * Simulate the native_call router that the Rust VM calls into.
     * In a full implementation, this bridges memory pointers.
     */
    public handleNativeCall(id: number, argsJson: string): string {
        switch (id) {
            case 1:
                return this.getWebGLFingerprint();
            case 2:
                return this.getCanvasFingerprint();
            case 3:
                return JSON.stringify(this.checkAutomation());
            case 4:
                return JSON.stringify(this.getScreenMetrics());
            default:
                return JSON.stringify({ error: "Unknown native call ID" });
        }
    }

    private getWebGLFingerprint(): string {
        if (this.webglInfo) return this.webglInfo;
        
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return "WebGL Not Supported";
            
            const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                const vendor = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
                const renderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                this.webglInfo = `${vendor} ~ ${renderer}`;
            } else {
                this.webglInfo = "Debug Info Blocked";
            }
        } catch (e) {
            this.webglInfo = "WebGL Error";
        }
        
        return this.webglInfo;
    }

    private getCanvasFingerprint(): string {
        if (this.canvasHash) return this.canvasHash;
        
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return "Canvas Not Supported";
            
            // Draw a complex shape with text to trigger OS-level font rendering differences
            ctx.textBaseline = "top";
            ctx.font = "14px 'Arial'";
            ctx.textBaseline = "alphabetic";
            ctx.fillStyle = "#f60";
            ctx.fillRect(125,1,62,20);
            ctx.fillStyle = "#069";
            ctx.fillText("FortressWASM, 2026", 2, 15);
            ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
            ctx.fillText("FortressWASM, 2026", 4, 17);
            
            // In a real app we'd hash the dataURL, here we just return the raw string length/sample as a mock fingerprint
            const data = canvas.toDataURL();
            this.canvasHash = `canvas_${data.length}_${data.substring(data.length - 10)}`;
        } catch (e) {
            this.canvasHash = "Canvas Error";
        }
        
        return this.canvasHash;
    }

    private checkAutomation(): any {
        const navigatorAny = navigator as any;
        const windowAny = window as any;
        const documentAny = document as any;
        
        const isNative = (fn: any, name: string) => {
            try {
                const str = Function.prototype.toString.call(fn);
                return str === `function ${name}() { [native code] }`;
            } catch (e) {
                return false;
            }
        };

        const tampered = 
            !isNative(document.createElement, 'createElement') ||
            !isNative(WebGLRenderingContext.prototype.getParameter, 'getParameter') ||
            !isNative(HTMLCanvasElement.prototype.getContext, 'getContext') ||
            !isNative(Function.prototype.toString, 'toString');

        const hardwareConcurrency = navigator.hardwareConcurrency || 0;
        const deviceMemory = navigatorAny.deviceMemory || 0;

        return {
            webdriver: navigator.webdriver || false,
            cdc_adoQpoasnfa76pfcZLmcfl: windowAny.cdc_adoQpoasnfa76pfcZLmcfl_ !== undefined,
            document_selenium: documentAny.$cdc_asdjflasutopfhvcZLmcfl_ !== undefined,
            phantom: windowAny.callPhantom !== undefined || windowAny._phantom !== undefined,
            nightmare: windowAny.__nightmare !== undefined,
            domAutomation: windowAny.domAutomation !== undefined || windowAny.domAutomationController !== undefined,
            languages_match: navigator.languages && navigator.languages[0] === navigator.language,
            plugins_empty: navigator.plugins.length === 0,
            hardwareConcurrency,
            deviceMemory,
            prototype_tampered: tampered
        };
    }

    private getScreenMetrics(): any {
        return {
            width: window.screen.width,
            height: window.screen.height,
            availWidth: window.screen.availWidth,
            availHeight: window.screen.availHeight,
            colorDepth: window.screen.colorDepth,
            pixelRatio: window.devicePixelRatio || 1
        };
    }
}
