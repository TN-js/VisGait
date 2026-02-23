export async function loadSharedHeader() {
    const placeholder = document.getElementById('header-placeholder');
    if (!placeholder) return;

    try {
        const response = await fetch('header.html');
        const html = await response.text();
        placeholder.innerHTML = html;

        const path = window.location.pathname;
        
        // Remove active class from all first (safety measure)
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));

        if (path.includes('researcher.html')) {
            document.getElementById('nav-researcher')?.classList.add('active');
        } else if (path.includes('patient.html')) {
            document.getElementById('nav-patient')?.classList.add('active');
        } else {
            // Default/Landing page: index.html or root "/"
            document.getElementById('nav-about')?.classList.add('active');
        }
    } catch (e) { 
        console.error("Header error:", e); 
    }
}
