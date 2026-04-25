(function initGlobalBackgroundAnimation() {
    function mountParticles() {
        const root = document.getElementById('bg-particles');
        if (!root) return;

        root.innerHTML = '';
        const particleCount = window.innerWidth < 768 ? 24 : 40;

        for (let i = 0; i < particleCount; i += 1) {
            const dot = document.createElement('span');
            dot.className = 'bg-particle';

            const size = (Math.random() * 4 + 2.2).toFixed(2);
            const left = (Math.random() * 100).toFixed(2);
            const duration = (Math.random() * 11 + 10).toFixed(2);
            const delay = (Math.random() * -18).toFixed(2);

            dot.style.setProperty('--size', `${size}px`);
            dot.style.left = `${left}%`;
            dot.style.setProperty('--duration', `${duration}s`);
            dot.style.setProperty('--delay', `${delay}s`);
            root.appendChild(dot);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountParticles);
    } else {
        mountParticles();
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (resizeTimer) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(mountParticles, 200);
    });
})();
