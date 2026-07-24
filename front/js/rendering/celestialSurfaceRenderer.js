/**
 * Visible physical renderers for the Sun and Moon workspace layers.
 *
 * Cesium's built-in `scene.sun` / `scene.moon` primitives are submitted in
 * the environment pass.  Orbit's Tycho star dome is an ordinary primitive,
 * which means it can overwrite those environment bodies when its depth is
 * cleared for the opaque pass.  These surfaces deliberately live in the
 * normal `scene.primitives` collection instead, after the sky dome.
 *
 * The Moon keeps Cesium's own IAU lunar orientation and the exact scene
 * clock. Its map uses Cesium's packaged self-lit emission material so the
 * visible lunar face remains readable regardless of the current solar phase
 * while the primitive remains in the ordinary scene collection.
 */

// This detailed lunar map is kept as a project asset so Docker has it before
// the React runtime vendor files are built.
//
// The URL is root-relative, so it works from every hash route and from the
// Docker image's offline HTTP server.
export const MOON_TEXTURE_URL = "/assets/basemap/Moon_color_16bit_srgb_4k.png";

// Cesium's default perspective frustum ends around 500,000 km.  That safely
// covers the Moon but not the Sun at one astronomical unit, so a physical
// solar ellipsoid would be culled before it can render.  Keep a small margin
// around the full disc whenever the Sun layer is visible.
const SUN_FRUSTUM_MARGIN_MULTIPLIER = 1.03;
// WebGL guarantees support for at least a 2048-pixel texture dimension. The
// supplied lunar map is 4096 px wide, which can silently fall back to
// Cesium's black default texture on constrained GPUs.
const MOON_TEXTURE_SAFE_MAX_WIDTH = 2048;

function createCartesian(Cesium, x = 0, y = 0, z = 0) {
    return typeof Cesium?.Cartesian3 === "function"
        ? new Cesium.Cartesian3(x, y, z)
        : { x, y, z };
}

function createMatrix3(Cesium) {
    return typeof Cesium?.Matrix3 === "function" ? new Cesium.Matrix3() : {};
}

function createMatrix4(Cesium) {
    return typeof Cesium?.Matrix4 === "function" ? new Cesium.Matrix4() : {};
}

function cartesianDistance(Cesium, left, right) {
    if (!left || !right) {
        return null;
    }
    if (typeof Cesium?.Cartesian3?.distance === "function") {
        const distance = Cesium.Cartesian3.distance(left, right);
        return Number.isFinite(distance) ? distance : null;
    }
    const dx = Number(left.x) - Number(right.x);
    const dy = Number(left.y) - Number(right.y);
    const dz = Number(left.z) - Number(right.z);
    const distance = Math.hypot(dx, dy, dz);
    return Number.isFinite(distance) ? distance : null;
}

/**
 * Returns the minimum camera far plane needed to keep a complete physical
 * body inside Cesium's culling volume.  It intentionally uses the body's
 * real centre and radius; no display-scale proxy is introduced.
 */
export function getRequiredCelestialFrustumFar({
    Cesium,
    cameraPosition,
    bodyPosition,
    radiusMeters,
    marginMultiplier = SUN_FRUSTUM_MARGIN_MULTIPLIER
} = {}) {
    const radius = Number(radiusMeters);
    const distance = cartesianDistance(Cesium, cameraPosition, bodyPosition);
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(distance)) {
        return null;
    }
    const requestedMargin = Number(marginMultiplier);
    const margin = Number.isFinite(requestedMargin) && requestedMargin >= 1
        ? requestedMargin
        : SUN_FRUSTUM_MARGIN_MULTIPLIER;
    return (distance + radius) * margin;
}

function createLunarAxes(Cesium) {
    const computeMoon = Cesium?.Iau2000Orientation?.ComputeMoon;
    return typeof Cesium?.IauOrientationAxes === "function" && typeof computeMoon === "function"
        ? new Cesium.IauOrientationAxes(computeMoon)
        : null;
}

function computeFixedMatrix(Cesium, time, result) {
    const transforms = Cesium?.Transforms;
    const icrf = typeof transforms?.computeIcrfToFixedMatrix === "function"
        ? transforms.computeIcrfToFixedMatrix(time, result)
        : undefined;
    if (icrf) {
        return icrf;
    }
    return typeof transforms?.computeTemeToPseudoFixedMatrix === "function"
        ? transforms.computeTemeToPseudoFixedMatrix(time, result)
        : undefined;
}

/**
 * Matches Cesium's Moon update path while keeping the primitive in the
 * ordinary opaque collection.  This preserves the lunar body-fixed texture
 * orientation instead of pinning the supplied map to the Earth-fixed axes.
 */
export function computeMoonModelMatrix({
    Cesium,
    time,
    axes = createLunarAxes(Cesium),
    fixedMatrixResult = createMatrix3(Cesium),
    axesResult = createMatrix3(Cesium),
    inertialPositionResult = createCartesian(Cesium),
    result = createMatrix4(Cesium),
    fallbackPosition = null
} = {}) {
    if (!time || !Cesium?.Matrix4?.fromRotationTranslation) {
        return undefined;
    }

    const fixedMatrix = computeFixedMatrix(Cesium, time, fixedMatrixResult);
    const computeMoonPosition = Cesium?.Simon1994PlanetaryPositions?.computeMoonPositionInEarthInertialFrame;
    const inertialPosition = typeof computeMoonPosition === "function"
        ? computeMoonPosition(time, inertialPositionResult)
        : null;

    if (
        fixedMatrix
        && inertialPosition
        && axes
        && typeof axes.evaluate === "function"
        && typeof Cesium?.Matrix3?.transpose === "function"
        && typeof Cesium?.Matrix3?.multiply === "function"
        && typeof Cesium?.Matrix3?.multiplyByVector === "function"
    ) {
        // The order below is intentionally identical to Cesium.Moon#update.
        let lunarAxes = axes.evaluate(time, axesResult);
        lunarAxes = Cesium.Matrix3.transpose(lunarAxes, lunarAxes) || lunarAxes;
        lunarAxes = Cesium.Matrix3.multiply(fixedMatrix, lunarAxes, lunarAxes) || lunarAxes;
        const fixedPosition = Cesium.Matrix3.multiplyByVector(fixedMatrix, inertialPosition, inertialPosition) || inertialPosition;
        return Cesium.Matrix4.fromRotationTranslation(lunarAxes, fixedPosition, result);
    }

    if (fallbackPosition && typeof Cesium?.Matrix4?.fromTranslation === "function") {
        return Cesium.Matrix4.fromTranslation(fallbackPosition, result);
    }
    return undefined;
}

function createLunarPlaceholderCanvas() {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
        return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext?.("2d");
    if (context) {
        // Do not leave a black sphere onscreen during image decode/upload.
        context.fillStyle = "#b8b6af";
        context.fillRect(0, 0, 1, 1);
    }
    return canvas;
}

function loadWebGlSafeMoonTexture(textureUrl, {
    onImageCreated = null,
    onReady = null,
    onError = null
} = {}) {
    if (
        typeof Image !== "function"
        || typeof document === "undefined"
        || typeof document.createElement !== "function"
    ) {
        return null;
    }
    const image = new Image();
    // An Image whose only reference is a local variable can be collected
    // before its asynchronous decode completes. Let the material retain it
    // until either load or error resolves the request.
    onImageCreated?.(image);
    image.decoding = "async";
    image.onload = () => {
        const sourceWidth = Number(image.naturalWidth || image.width);
        const sourceHeight = Number(image.naturalHeight || image.height);
        if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
            onError?.(new Error("Moon texture has invalid dimensions."));
            return;
        }

        // Preserve the equirectangular map aspect ratio while guaranteeing
        // the upload stays inside the portable WebGL texture limit.
        const targetWidth = Math.min(MOON_TEXTURE_SAFE_MAX_WIDTH, Math.round(sourceWidth));
        const targetHeight = Math.max(1, Math.round(sourceHeight * (targetWidth / sourceWidth)));
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext?.("2d");
        if (!context) {
            onError?.(new Error("Moon texture canvas is unavailable."));
            return;
        }
        context.drawImage(image, 0, 0, targetWidth, targetHeight);
        onReady?.(canvas);
    };
    image.onerror = () => onError?.(new Error(`Unable to load Moon texture: ${textureUrl}`));
    image.src = textureUrl;
    return image;
}

function createMoonMaterial(Cesium, textureUrl, {
    textureContext = null,
    onTextureReady = null,
    onTextureError = null
} = {}) {
    if (typeof Cesium?.Material?.fromType !== "function") {
        return null;
    }
    // An Image material is purely diffuse, so the Moon becomes completely
    // black when its camera-facing hemisphere is outside the Sun's light.
    // Cesium's built-in EmissionMap fabric samples the exact same texture but
    // contributes it as emission, keeping lunar features visible at every
    // simulation time without a custom WebGL shader.
    const browserPlaceholder = createLunarPlaceholderCanvas();
    const material = Cesium.Material.fromType("EmissionMap", {
        // Node/test runtimes have no DOM canvas. They retain the URL path;
        // browser runtimes replace the placeholder once decoding completes.
        image: browserPlaceholder || textureUrl,
        channels: "rgb",
        repeat: typeof Cesium?.Cartesian2 === "function" ? new Cesium.Cartesian2(1, 1) : { x: 1, y: 1 }
    });
    loadWebGlSafeMoonTexture(textureUrl, {
        onImageCreated: (image) => {
            material._orbitMoonSourceImage = image;
        },
        onReady: (canvas) => {
            let textureSource = canvas;
            // Cesium can bind a supplied Texture in the same material update.
            // Swapping from one canvas source to another otherwise needs an
            // extra idle render pass, during which Cesium samples its black
            // default texture. Creating the texture explicitly avoids that
            // transient (and, in request-render mode, persistent) black Moon.
            if (textureContext && typeof Cesium?.Texture === "function") {
                try {
                    textureSource = new Cesium.Texture({
                        context: textureContext,
                        source: canvas
                    });
                } catch (error) {
                    // The canvas remains a compatible fallback on contexts
                    // that do not permit explicit texture allocation here.
                    onTextureError?.(error);
                }
            }
            material.uniforms.image = textureSource;
            material._orbitMoonSourceImage = null;
            onTextureReady?.();
        },
        onError: (error) => {
            material._orbitMoonSourceImage = null;
            onTextureError?.(error);
        }
    });
    // The 2048-by-1024 safe canvas remains power-of-two, so Cesium can build a
    // mip chain. Trilinear sampling prevents distant craters and the limb
    // from aliasing, while linear magnification keeps close inspection smooth.
    if (Cesium?.TextureMinificationFilter?.LINEAR_MIPMAP_LINEAR !== undefined) {
        material.minificationFilter = Cesium.TextureMinificationFilter.LINEAR_MIPMAP_LINEAR;
    }
    if (Cesium?.TextureMagnificationFilter?.LINEAR !== undefined) {
        material.magnificationFilter = Cesium.TextureMagnificationFilter.LINEAR;
    }
    // This matches Cesium.Moon: an external body must stay in the opaque
    // pipeline even if a browser reports alpha metadata for the image.
    material.translucent = false;
    return material;
}

function createSunMaterial(Cesium) {
    if (typeof Cesium?.Material !== "function") {
        return null;
    }
    const color = Cesium?.Color?.fromCssColorString?.("#ffe7a3")
        || (typeof Cesium?.Color === "function" ? new Cesium.Color(1, 0.9, 0.64, 1) : { red: 1, green: 0.9, blue: 0.64, alpha: 1 });
    const material = new Cesium.Material({
        fabric: {
            type: "OrbitSolarEmission",
            uniforms: {
                color,
                // Keep the controls in the material rather than in the
                // renderer: this is a physical, self-lit photosphere, not a
                // display-scale proxy or a screen-space sprite.
                granulationScale: 34.0,
                flareIntensity: 0.82
            },
            // The surface must remain visible at the physical solar distance.
            // It is deliberately self-lit, but not flat: a stable, body-space
            // procedural photosphere gives the focused Sun visible cellular
            // granulation, convection-like turbulence and a warm limb/focal
            // glow without relying on an external image asset.
            source: `
                float solarHash(vec2 point)
                {
                    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
                }

                vec2 solarHash2(vec2 point)
                {
                    return fract(sin(vec2(
                        dot(point, vec2(127.1, 311.7)),
                        dot(point, vec2(269.5, 183.3))
                    )) * 43758.5453123);
                }

                float solarNoise(vec2 point)
                {
                    vec2 cell = floor(point);
                    vec2 local = fract(point);
                    local = local * local * (3.0 - 2.0 * local);
                    return mix(
                        mix(solarHash(cell), solarHash(cell + vec2(1.0, 0.0)), local.x),
                        mix(solarHash(cell + vec2(0.0, 1.0)), solarHash(cell + vec2(1.0, 1.0)), local.x),
                        local.y
                    );
                }

                float solarFbm(vec2 point)
                {
                    float value = 0.0;
                    float amplitude = 0.56;
                    for (int octave = 0; octave < 4; octave++) {
                        value += solarNoise(point) * amplitude;
                        point = point * 2.03 + vec2(17.13, 9.21);
                        amplitude *= 0.5;
                    }
                    return value;
                }

                // A small Worley field forms the bright cell centres and
                // darker intergranular lanes of the solar photosphere.
                float solarCells(vec2 point)
                {
                    vec2 cell = floor(point);
                    vec2 local = fract(point);
                    float nearest = 2.0;
                    for (int y = -1; y <= 1; y++) {
                        for (int x = -1; x <= 1; x++) {
                            vec2 offset = vec2(float(x), float(y));
                            vec2 feature = solarHash2(cell + offset);
                            vec2 delta = offset + feature - local;
                            nearest = min(nearest, dot(delta, delta));
                        }
                    }
                    return 1.0 - smoothstep(0.08, 0.78, sqrt(nearest));
                }

                czm_material czm_getMaterial(czm_materialInput materialInput)
                {
                    czm_material material = czm_getDefaultMaterial(materialInput);
                    // The ellipsoid ST coordinates keep the pattern attached
                    // locked to the physical solar body while the camera or
                    // Earth frame moves. The low-rate drift only animates the
                    // convection texture; it does not affect ephemerides.
                    float time = czm_frameNumber * 0.00115;
                    vec2 uv = vec2(fract(materialInput.st.s), clamp(materialInput.st.t, 0.0, 1.0));
                    vec2 cellsUv = vec2(uv.x * 2.0, uv.y) * granulationScale;
                    cellsUv += vec2(time, -time * 0.37);
                    float cells = solarCells(cellsUv);
                    float turbulence = solarFbm(cellsUv * 1.72 + vec2(-time * 1.8, time));
                    float activeRegions = solarFbm(cellsUv * 0.27 + vec2(5.7, 2.9));
                    float granulation = clamp(cells * 0.68 + turbulence * 0.50, 0.0, 1.0);

                    // At the disc centre the observer sees the hot, bright
                    // photosphere; near its edge a controlled orange corona
                    // gives the Sun a readable 360-degree focal glow.
                    vec3 normal = normalize(materialInput.normalEC);
                    vec3 toEye = normalize(materialInput.positionToEyeEC);
                    float facing = clamp(dot(normal, toEye), 0.0, 1.0);
                    float centreGlow = pow(facing, 1.45);
                    float limbGlow = pow(1.0 - facing, 2.1);
                    vec3 coolLanes = vec3(0.92, 0.115, 0.008);
                    vec3 hotCells = vec3(1.0, 0.87, 0.32);
                    vec3 photosphere = mix(coolLanes, hotCells, granulation);
                    photosphere = mix(photosphere, vec3(1.0, 0.46, 0.06), activeRegions * 0.22);
                    vec3 corona = vec3(1.0, 0.23, 0.012) * limbGlow * flareIntensity;
                    vec3 focalGlow = vec3(1.0, 0.73, 0.18) * centreGlow * 0.46;

                    material.diffuse = vec3(0.0);
                    material.emission = (photosphere * (0.86 + centreGlow * 0.42) + focalGlow + corona) * color.rgb;
                    // Cesium's Fabric material specular field is a scalar
                    // intensity (not an RGB vector). Keeping this scalar is
                    // required by the Cesium 1.143 material struct and avoids
                    // a WebGL fragment-shader dimension mismatch.
                    material.specular = 0.0;
                    material.alpha = color.a;
                    return material;
                }
            `
        }
    });
    material.translucent = false;
    return material;
}

function addPrimitive(collection, primitive) {
    return typeof collection?.add === "function" ? collection.add(primitive) || primitive : primitive;
}

function removePrimitive(collection, primitive) {
    if (!primitive) return;
    if (typeof collection?.remove === "function") {
        collection.remove(primitive);
    }
    if (typeof primitive.destroy === "function" && !primitive.isDestroyed?.()) {
        primitive.destroy();
    }
}

/**
 * Builds one renderable body.  The caller owns layer state and supplies the
 * Earth-fixed position resolver used by its transparent/non-rendering layer
 * anchor.  Picking the surface resolves back to that same anchor entity.
 */
export function createCelestialSurfaceRenderer({
    kind,
    viewer,
    Cesium,
    radiusMeters,
    textureUrl = MOON_TEXTURE_URL,
    getPosition,
    onRenderStateChange = null,
    logger = null
} = {}) {
    const normalizedKind = String(kind || "").trim().toLowerCase();
    const isMoon = normalizedKind === "moon";
    const isSun = normalizedKind === "sun";
    const collection = viewer?.scene?.primitives;
    const supported = Boolean(
        (isMoon || isSun)
        && Number.isFinite(Number(radiusMeters))
        && Number(radiusMeters) > 0
        && typeof Cesium?.EllipsoidPrimitive === "function"
        && collection?.add
    );

    let primitive = null;
    let pickId = null;
    let visible = false;
    let failed = false;
    let renderable = false;
    let preRenderListener = null;
    let originalSunFrustumFar = null;
    let appliedSunFrustumFar = null;
    const lunarAxes = isMoon ? createLunarAxes(Cesium) : null;
    const fixedMatrixResult = createMatrix3(Cesium);
    const axesResult = createMatrix3(Cesium);
    const inertialPositionResult = createCartesian(Cesium);
    const modelMatrixResult = createMatrix4(Cesium);
    const positionResult = createCartesian(Cesium);

    const publishRenderState = (nextRenderable) => {
        const normalizedRenderable = nextRenderable === true;
        if (renderable === normalizedRenderable) {
            return;
        }
        renderable = normalizedRenderable;
        onRenderStateChange?.({
            kind: normalizedKind,
            primitive,
            renderable
        });
    };

    const extendSunFrustum = (position) => {
        if (!isSun) {
            return;
        }
        const frustum = viewer?.camera?.frustum;
        const currentFar = Number(frustum?.far);
        const requiredFar = getRequiredCelestialFrustumFar({
            Cesium,
            cameraPosition: viewer?.camera?.positionWC,
            bodyPosition: position,
            radiusMeters
        });
        if (!frustum || !Number.isFinite(currentFar) || !Number.isFinite(requiredFar)) {
            return;
        }
        if (originalSunFrustumFar === null) {
            originalSunFrustumFar = currentFar;
        }
        const nextFar = Math.max(currentFar, requiredFar);
        if (nextFar > currentFar) {
            frustum.far = nextFar;
        }
        appliedSunFrustumFar = Number(frustum.far);
    };

    const restoreSunFrustum = () => {
        if (!isSun || originalSunFrustumFar === null) {
            return;
        }
        const frustum = viewer?.camera?.frustum;
        const currentFar = Number(frustum?.far);
        // Do not undo a larger far plane that another camera feature applied
        // after this renderer.  The normal path restores the pre-Sun value.
        if (
            frustum
            && Number.isFinite(currentFar)
            && Number.isFinite(appliedSunFrustumFar)
            && currentFar <= appliedSunFrustumFar
        ) {
            frustum.far = originalSunFrustumFar;
        }
        originalSunFrustumFar = null;
        appliedSunFrustumFar = null;
    };

    const update = (time = viewer?.clock?.currentTime) => {
        if (!primitive || !visible) {
            publishRenderState(false);
            return false;
        }
        const position = typeof getPosition === "function"
            ? getPosition(time, positionResult)
            : null;
        if (!position) {
            primitive.show = false;
            publishRenderState(false);
            return false;
        }

        const modelMatrix = isMoon
            ? computeMoonModelMatrix({
                Cesium,
                time,
                axes: lunarAxes,
                fixedMatrixResult,
                axesResult,
                inertialPositionResult,
                result: modelMatrixResult,
                fallbackPosition: position
            })
            : Cesium?.Matrix4?.fromTranslation?.(position, modelMatrixResult);
        if (!modelMatrix) {
            primitive.show = false;
            publishRenderState(false);
            return false;
        }

        primitive.modelMatrix = modelMatrix;
        primitive.show = true;
        extendSunFrustum(position);
        // The Tycho dome can be recreated after this renderer.  Keeping the
        // body last makes its opaque pass deterministic while depth testing
        // still resolves correct Sun/Moon occlusion.
        collection?.raiseToTop?.(primitive);
        publishRenderState(true);
        return true;
    };

    const ensure = () => {
        if (primitive || !supported || failed) {
            return primitive;
        }
        try {
            const material = isMoon
                ? createMoonMaterial(Cesium, textureUrl, {
                    textureContext: viewer?.scene?.context || null,
                    onTextureReady: () => viewer?.scene?.requestRender?.(),
                    onTextureError: (error) => logger?.warn?.("No se pudo cargar la textura de la Luna.", error)
                })
                : createSunMaterial(Cesium);
            if (!material) {
                failed = true;
                return null;
            }
            primitive = addPrimitive(collection, new Cesium.EllipsoidPrimitive({
                radii: createCartesian(Cesium, radiusMeters, radiusMeters, radiusMeters),
                material,
                // The lunar map is self-lit through EmissionMap. Keeping the
                // normal scene lighting route preserves the compatible
                // primitive path while no solar phase can black out the map.
                // The Sun is self-lit too, so this is harmless for it.
                onlySunLighting: false,
                // Cesium's native Moon deliberately disables depth testing
                // for an external ephemeris body. Matching that route keeps
                // this surface from being rejected by the globe/sky depth
                // buffer before its opaque pass is submitted.
                depthTestEnabled: false,
                show: false,
                id: pickId
            }));
            preRenderListener = (_scene, frameTime) => update(frameTime || viewer?.clock?.currentTime);
            viewer?.scene?.preRender?.addEventListener?.(preRenderListener);
            return primitive;
        } catch (error) {
            failed = true;
            logger?.warn?.(`No se pudo crear el renderizador del ${normalizedKind}.`, error);
            return null;
        }
    };

    const setVisible = (nextVisible) => {
        visible = nextVisible === true;
        if (!visible) {
            if (primitive) primitive.show = false;
            publishRenderState(false);
            restoreSunFrustum();
            viewer?.scene?.requestRender?.();
            return supported && !failed;
        }
        const target = ensure();
        if (!target) {
            return false;
        }
        const rendered = update(viewer?.clock?.currentTime);
        viewer?.scene?.requestRender?.();
        return rendered;
    };

    const setPickId = (entity) => {
        pickId = entity || null;
        if (primitive) {
            primitive.id = pickId;
        }
    };

    const destroy = () => {
        if (preRenderListener) {
            viewer?.scene?.preRender?.removeEventListener?.(preRenderListener);
            preRenderListener = null;
        }
        removePrimitive(collection, primitive);
        primitive = null;
        publishRenderState(false);
        restoreSunFrustum();
        visible = false;
    };

    return {
        supported,
        setVisible,
        setPickId,
        update,
        destroy,
        getPrimitive: () => primitive,
        get isRenderable() { return renderable; },
        get visible() { return visible; }
    };
}
