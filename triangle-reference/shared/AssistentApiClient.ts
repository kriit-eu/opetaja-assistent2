// Simplified AssistentApiClient for triangle reference
export default class AssistentApiClient {
    static kriitUrl = process.env.PLASMO_PUBLIC_KRIIT_URL_LIVE || 'http://localhost:3000'

    static async get(endpoint: string) {
        // Simplified GET request
        const response = await fetch(`/api${endpoint}`)
        return await response.json()
    }

    static async request(method: string, url: string, data?: any) {
        // Simplified request method
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: data ? JSON.stringify(data) : undefined
        })
        return { data: await response.json() }
    }
}
