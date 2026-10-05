// Template de configuração por ambiente/cliente.
// Copie este arquivo para "config.js" (que é ignorado pelo git) e preencha
// com os dados do projeto Firebase/Firestore e do Azure AD do Tigre.
// "config.js" é o ÚNICO arquivo que precisa mudar para apontar o front-end
// para o banco de dados de um cliente diferente.
window.APP_CONFIG = {
    // Firebase Console > Configurações do projeto > Seus apps > SDK setup and configuration.
    // Precisa ser um projeto Firebase/Firestore próprio do Tigre (hoje aponta para o
    // projeto da Biti9 - "biti9-ai-techlead" - que NÃO deve ser usado em produção do cliente).
    firebase: {
        apiKey: "SUBSTITUA_PELO_API_KEY_DO_TIGRE",
        authDomain: "SUBSTITUA_PELO_AUTH_DOMAIN_DO_TIGRE", // ex: tigre-showroom.firebaseapp.com
        projectId: "SUBSTITUA_PELO_PROJECT_ID_DO_TIGRE",
        storageBucket: "SUBSTITUA_PELO_STORAGE_BUCKET_DO_TIGRE",
        messagingSenderId: "SUBSTITUA_PELO_MESSAGING_SENDER_ID_DO_TIGRE",
        appId: "SUBSTITUA_PELO_APP_ID_DO_TIGRE",
    },

    // ID do tenant Azure AD do Tigre, usado para restringir o login Microsoft
    // (OAuthProvider "microsoft.com") a contas da organização do cliente.
    // Deixe null para não restringir por tenant (qualquer conta Microsoft pode logar).
    msTenantId: null,
};
