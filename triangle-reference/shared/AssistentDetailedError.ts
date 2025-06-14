// Simplified AssistentDetailedError for triangle reference
export class AssistentDetailedError extends Error {
    constructor(
        public code: number,
        public title: string,
        public detail: string
    ) {
        super(`${code}: ${title} - ${detail}`)
        this.name = 'AssistentDetailedError'
    }
}
