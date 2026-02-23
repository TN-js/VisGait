import { loadSharedHeader } from "./main.js";

async function initAboutPage() {
    // Load the shared header and highlight the "About Us" tab
    await loadSharedHeader();
    
    console.log("About Us page initialized.");
    // You can add animations or specific "About Us" logic here
}

initAboutPage();