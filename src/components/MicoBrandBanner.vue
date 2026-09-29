<template>
    <div class="mico-brand-banner" aria-label="MicoMusic 米可品牌标识">
        <span class="brand-copy">
            <strong>MicoMusic</strong>
            <small>让音乐陪伴你</small>
        </span>
        <img src="/assets/images/mico/onboarding/mico-onboarding-chibi-welcome-v1.png" alt="挥手的 Q 版米可" />
    </div>
</template>

<style scoped>
.mico-brand-banner {
    position: absolute;
    top: 0;
    right: 15px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    width: 180px;
    height: 102px;
    overflow: hidden;
    border-radius: 0 0 12px 12px;
    background: linear-gradient(125deg, #1e2855, #4a4389 70%, #8672ba);
    color: #fff;
    pointer-events: none;
    user-select: none;
}

.brand-copy {
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-left: 10px;
    white-space: nowrap;
}

.brand-copy strong { font-size: 13px; }
.brand-copy small { font-size: 8px; opacity: .82; }

img {
    position: absolute;
    right: -8px;
    bottom: -13px;
    width: 83px;
    height: 100px;
    object-fit: contain;
}
</style>
