/* Cosmic Wimpout 2.0 — the WebGPU renderer. Raw WebGPU, no engine.

   A frame, at 1.0's logical resolution:
     compute   node positions -> per-node F -> the skinned cube surfaces
     shadow    the cubes from the light, depth only
     scene     cloth, rim and cubes, writing tone / object / depth
     post      tone to the live four-colour palette with an ordered dither,
               cube edges, and the held and locked rings

   The canvas is sized by the shell to the same logical size as 1.0's pixel
   canvas and scaled up by CSS with crisp pixels, so the 3D and the type and
   buttons drawn over it share one grid. */
(function (global) {
  'use strict';
  const CW = global.CW;
  const U = GPUBufferUsage, T = GPUTextureUsage;
  const SHADOW = 1024, SHADOW_HALF = 7.5, SHADOW_RANGE = 40;

  class Renderer {
    static async create(canvas, world, maxDice) {
      if (!('gpu' in navigator) || !navigator.gpu) {
        throw Object.assign(new Error('no-webgpu'), { reason: global.isSecureContext === false ? 'insecure' : 'missing' });
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw Object.assign(new Error('no-adapter'), { reason: 'adapter' });
      const device = await adapter.requestDevice();
      const r = new Renderer(canvas, device, world, maxDice);
      await r.init();
      return r;
    }

    constructor(canvas, device, world, maxDice) {
      this.canvas = canvas;
      this.device = device;
      this.world = world;
      this.maxDice = maxDice;
      this.topo = world.topo;
      this.context = canvas.getContext('webgpu');
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
      this.errors = [];
      device.addEventListener('uncapturederror', e => {
        this.errors.push(e.error.message);
        if (this.errors.length < 6) console.error('WebGPU:', e.error.message);
      });
      this.lost = false;
      device.lost.then(info => { this.lost = info; });
    }

    async init() {
      const d = this.device, topo = this.topo, nn = topo.nn, MD = this.maxDice;
      const mesh = CW.mesh.diceMesh(topo);
      this.vertsPerDie = mesh.count;
      this.indexCount = mesh.indices.length;

      const buf = (size, usage, data) => {
        const b = d.createBuffer({ size: Math.ceil(size / 16) * 16, usage, mappedAtCreation: !!data });
        if (data) {
          new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength));
          b.unmap();
        }
        return b;
      };
      this.frameUBO = buf(256, U.UNIFORM | U.COPY_DST);
      this.computeUBO = buf(16, U.UNIFORM | U.COPY_DST);
      this.postUBO = buf(144, U.UNIFORM | U.COPY_DST);
      this.nodesBuf = buf(MD * nn * 16, U.STORAGE | U.COPY_DST);
      this.infoBuf = buf(mesh.nodeInfo.byteLength, U.STORAGE, new Uint8Array(mesh.nodeInfo));
      this.defoBuf = buf(MD * nn * 48, U.STORAGE);
      this.restBuf = buf(mesh.restData.byteLength, U.STORAGE, new Uint8Array(mesh.restData));
      this.vertsBuf = buf(MD * mesh.count * 64, U.STORAGE);
      this.diceBuf = buf(MD * 64, U.STORAGE | U.COPY_DST);
      this.indexBuf = buf(mesh.indices.byteLength, U.INDEX, mesh.indices);
      const board = CW.mesh.boardMesh(CW.soft.TABLE);
      this.boardVB = buf(board.vertices.byteLength, U.VERTEX, board.vertices);
      this.boardIB = buf(board.indices.byteLength, U.INDEX, board.indices);
      this.boardCount = board.indices.length;
      this.nodeData = new Float32Array(MD * nn * 4);
      this.diceData = new Float32Array(MD * 16);
      this.frameData = new ArrayBuffer(256);
      this.postData = new Float32Array(36);

      // 1.0's cube symbols, texel for texel
      const fa = CW.sprites.faceAtlas();
      this.faceTex = d.createTexture({ size: [fa.w, fa.h], format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST });
      d.queue.writeTexture({ texture: this.faceTex }, fa.data, { bytesPerRow: fa.w * 4 }, [fa.w, fa.h]);
      // the cloth, repainted when the score on it changes
      this.cloth = CW.sprites.makeScreen();
      this.clothTex = null;
      this.clothKey = '';
      this.shadowMap = d.createTexture({ size: [SHADOW, SHADOW], format: 'depth32float', usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });

      await this.buildPipelines();
    }

    async buildPipelines() {
      const d = this.device, S = CW.shaders;
      const check = async (mod, name) => {
        const info = await mod.getCompilationInfo();
        const errs = info.messages.filter(m => m.type === 'error');
        if (errs.length) {
          throw Object.assign(new Error(errs.map(m => name + ':' + m.lineNum + ':' + m.linePos + ' ' + m.message).join('\n')), { reason: 'shader' });
        }
      };
      const mCompute = d.createShaderModule({ code: S.compute });
      const mScene = d.createShaderModule({ code: S.scene });
      const mPost = d.createShaderModule({ code: S.post });
      await Promise.all([check(mCompute, 'compute'), check(mScene, 'scene'), check(mPost, 'post')]);

      const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, FR = GPUShaderStage.FRAGMENT, CS = GPUShaderStage.COMPUTE;
      const bglCompute = d.createBindGroupLayout({ entries: [
        { binding: 0, visibility: CS, buffer: { type: 'uniform' } },
        { binding: 1, visibility: CS, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: CS, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: CS, buffer: { type: 'storage' } },
        { binding: 4, visibility: CS, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: CS, buffer: { type: 'storage' } },
      ] });
      const plCompute = d.createPipelineLayout({ bindGroupLayouts: [bglCompute] });
      this.pNodeF = d.createComputePipeline({ layout: plCompute, compute: { module: mCompute, entryPoint: 'nodeF' } });
      this.pSkin = d.createComputePipeline({ layout: plCompute, compute: { module: mCompute, entryPoint: 'skin' } });
      this.bgCompute = d.createBindGroup({ layout: bglCompute, entries: [
        { binding: 0, resource: { buffer: this.computeUBO } },
        { binding: 1, resource: { buffer: this.nodesBuf } },
        { binding: 2, resource: { buffer: this.infoBuf } },
        { binding: 3, resource: { buffer: this.defoBuf } },
        { binding: 4, resource: { buffer: this.restBuf } },
        { binding: 5, resource: { buffer: this.vertsBuf } },
      ] });

      /* Two layouts over the same frame data: the shadow pass cannot read the
         shadow map it is writing, so it gets one without it. */
      const frameEntries = [
        { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
        { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: VF, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: VF, buffer: { type: 'read-only-storage' } },
      ];
      const bglLight = d.createBindGroupLayout({ entries: frameEntries });
      const bglScene = d.createBindGroupLayout({ entries: frameEntries.concat([
        { binding: 4, visibility: FR, texture: { sampleType: 'unfilterable-float' } },
        { binding: 5, visibility: FR, texture: { sampleType: 'unfilterable-float' } },
        { binding: 6, visibility: FR, texture: { sampleType: 'depth' } },
      ]) });
      const frameRes = [
        { binding: 0, resource: { buffer: this.frameUBO } },
        { binding: 1, resource: { buffer: this.vertsBuf } },
        { binding: 2, resource: { buffer: this.diceBuf } },
        { binding: 3, resource: { buffer: this.restBuf } },
      ];
      this.bgLight = d.createBindGroup({ layout: bglLight, entries: frameRes });
      // the cloth's size follows the screen, so its bind group is made with it
      this.sceneGroup = () => d.createBindGroup({ layout: bglScene, entries: frameRes.concat([
        { binding: 4, resource: this.faceTex.createView() },
        { binding: 5, resource: this.clothTex.createView() },
        { binding: 6, resource: this.shadowMap.createView() },
      ]) });

      this.pShadow = d.createRenderPipeline({
        layout: d.createPipelineLayout({ bindGroupLayouts: [bglLight] }),
        vertex: { module: mScene, entryPoint: 'vs_light' },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
      });
      const plScene = d.createPipelineLayout({ bindGroupLayouts: [bglScene] });
      const target = [{ format: 'rgba16float' }];
      const depth = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
      this.pBoard = d.createRenderPipeline({
        layout: plScene,
        vertex: { module: mScene, entryPoint: 'vs_board', buffers: [{
          arrayStride: 36, attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x2' },
            { shaderLocation: 3, offset: 32, format: 'float32' }] }] },
        fragment: { module: mScene, entryPoint: 'fs_board', targets: target },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: depth,
      });
      this.pDice = d.createRenderPipeline({
        layout: plScene,
        vertex: { module: mScene, entryPoint: 'vs_dice' },
        fragment: { module: mScene, entryPoint: 'fs_dice', targets: target },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: depth,
      });

      this.bglPost = d.createBindGroupLayout({ entries: [
        { binding: 0, visibility: FR, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: FR, buffer: { type: 'uniform' } },
      ] });
      this.pPost = d.createRenderPipeline({
        layout: d.createPipelineLayout({ bindGroupLayouts: [this.bglPost] }),
        vertex: { module: mPost, entryPoint: 'vs_full' },
        fragment: { module: mPost, entryPoint: 'fs_post', targets: [{ format: this.format }] },
      });
    }

    // the shell sets the logical size; targets follow it
    setSize(w, h) {
      if (this.w === w && this.h === h) return;
      this.w = w; this.h = h;
      this.canvas.width = w; this.canvas.height = h;
      if (this.sceneTex) { this.sceneTex.destroy(); this.depthTex.destroy(); }
      const d = this.device;
      this.sceneTex = d.createTexture({ size: [w, h], format: 'rgba16float', usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
      this.depthTex = d.createTexture({ size: [w, h], format: 'depth24plus', usage: T.RENDER_ATTACHMENT });
      this.bgPost = d.createBindGroup({ layout: this.bglPost, entries: [
        { binding: 0, resource: this.sceneTex.createView() },
        { binding: 1, resource: { buffer: this.postUBO } },
      ] });
    }

    /* Repaint the cloth only when what is printed on it changes. Its size is
       the mat's size on screen, so it is remade when the screen's shape is. */
    updateCloth(opts) {
      const key = JSON.stringify(opts);
      if (key === this.clothKey) return;
      this.clothKey = key;
      const cv = CW.sprites.paintCloth(this.cloth, opts);
      if (!this.clothTex || this.clothTex.width !== cv.width || this.clothTex.height !== cv.height) {
        if (this.clothTex) this.clothTex.destroy();
        this.clothTex = this.device.createTexture({ size: [cv.width, cv.height], format: 'rgba8unorm',
          usage: T.TEXTURE_BINDING | T.COPY_DST | T.RENDER_ATTACHMENT });
        this.bgScene = this.sceneGroup();
      }
      this.device.queue.copyExternalImageToTexture({ source: cv }, { texture: this.clothTex }, [cv.width, cv.height]);
    }

    /* scene = { cam, time, palette: ['#rrggbb' x4], dice: [{ visible, sun,
       dim, mark, faces[6] }], cloth: { goal, points } } */
    render(scene) {
      if (this.lost || !this.w) return;
      const d = this.device, q = d.queue, topo = this.topo, nn = topo.nn;
      const nd = this.world.bodies.length;
      // the cloth's size: the mat's, in logical pixels, with the camera at rest
      const ppu = scene.cam.clothScale(), ext = CW.soft.TABLE.extent();
      const size = Math.max(160, Math.round(2 * Math.max(ext[0], ext[1]) * ppu));
      this.updateCloth(Object.assign({ w: size, h: size }, scene.cloth));

      this.world.pack(this.nodeData);
      q.writeBuffer(this.nodesBuf, 0, this.nodeData, 0, nd * nn * 4);

      const dd = this.diceData, pd = this.postData;
      scene.dice.forEach((s, i) => {
        const o = i * 16;
        dd[o] = s.sun ? 1 : 0; dd[o + 1] = s.dim ? 1 : 0; dd[o + 2] = s.mark || 0; dd[o + 3] = s.visible ? 1 : 0;
        for (let k = 0; k < 4; k++) dd[o + 4 + k] = s.faces[k];
        dd[o + 8] = s.faces[4]; dd[o + 9] = s.faces[5];
        pd.set([dd[o], dd[o + 1], dd[o + 2], dd[o + 3]], 16 + i * 4);
      });
      q.writeBuffer(this.diceBuf, 0, dd, 0, nd * 16);
      scene.palette.forEach((hex, i) => {
        const n = parseInt(hex.slice(1), 16);
        pd.set([(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1], i * 4);
      });
      q.writeBuffer(this.postUBO, 0, pd);

      const cam = scene.cam, M = CW.m4;
      const L = CW.v3.norm([-0.45, 1.0, 0.62]);
      const lview = M.lookAt([L[0] * 20, L[1] * 20, L[2] * 20], [0, 0, 0], [0, 0, -1]);
      const lproj = M.ortho(-SHADOW_HALF, SHADOW_HALF, -SHADOW_HALF, SHADOW_HALF, 0.5, SHADOW_RANGE);
      const f = new Float32Array(this.frameData), u = new Uint32Array(this.frameData);
      f.set(cam.viewProj, 0);
      f.set(M.mul(lproj, lview), 16);
      f.set([cam.eye[0], cam.eye[1], cam.eye[2], scene.time], 32);
      f.set([L[0], L[1], L[2], topo.a - topo.r], 36);
      f.set([this.w, this.h, 1 / this.w, 1 / this.h], 40);
      u.set([nn, this.vertsPerDie, nd, topo.n], 44);
      const Tb = CW.soft.TABLE;
      f.set([Tb.L, Tb.matR, Tb.rimR, Tb.rimT], 48);
      q.writeBuffer(this.frameUBO, 0, this.frameData);
      q.writeBuffer(this.computeUBO, 0, new Uint32Array([nn, this.vertsPerDie, nd, topo.n]));

      const visible = [];
      scene.dice.forEach((s, i) => { if (s.visible) visible.push(i); });
      const drawDice = pass => {
        pass.setIndexBuffer(this.indexBuf, 'uint32');
        for (const i of visible) pass.drawIndexed(this.indexCount, 1, 0, 0, i);
      };

      const enc = d.createCommandEncoder();
      {
        const p = enc.beginComputePass();
        p.setBindGroup(0, this.bgCompute);
        p.setPipeline(this.pNodeF); p.dispatchWorkgroups(Math.ceil(nn * nd / 64));
        p.setPipeline(this.pSkin); p.dispatchWorkgroups(Math.ceil(this.vertsPerDie * nd / 64));
        p.end();
      }
      {
        const p = enc.beginRenderPass({ colorAttachments: [],
          depthStencilAttachment: { view: this.shadowMap.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } });
        p.setPipeline(this.pShadow); p.setBindGroup(0, this.bgLight);
        drawDice(p);
        p.end();
      }
      {
        const p = enc.beginRenderPass({
          colorAttachments: [{ view: this.sceneTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 1e4, 1] }],
          depthStencilAttachment: { view: this.depthTex.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
        });
        p.setBindGroup(0, this.bgScene);
        p.setPipeline(this.pBoard);
        p.setVertexBuffer(0, this.boardVB); p.setIndexBuffer(this.boardIB, 'uint32');
        p.drawIndexed(this.boardCount);
        p.setPipeline(this.pDice);
        drawDice(p);
        p.end();
      }
      {
        const p = enc.beginRenderPass({ colorAttachments: [{
          view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        p.setPipeline(this.pPost); p.setBindGroup(0, this.bgPost);
        p.draw(3);
        p.end();
      }
      q.submit([enc.finish()]);
    }
  }

  CW.Renderer = Renderer;
})(window);
