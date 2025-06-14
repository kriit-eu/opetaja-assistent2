// Simplified AssistentDom for triangle reference
export default class AssistentDom {
    static createButton(className: string, textContent: string, clickHandler: () => void): HTMLButtonElement {
        const button = document.createElement('button')
        button.className = className
        button.textContent = textContent
        button.addEventListener('click', clickHandler)
        return button
    }

    static async waitForElement(selector: string): Promise<HTMLElement | null> {
        return new Promise((resolve) => {
            const element = document.querySelector(selector) as HTMLElement
            if (element) {
                resolve(element)
                return
            }
            
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector) as HTMLElement
                if (element) {
                    observer.disconnect()
                    resolve(element)
                }
            })
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            })
        })
    }

    static async waitForElementToBeVisible(selector: string): Promise<HTMLElement | null> {
        return this.waitForElement(selector)
    }

    static async waitForAttributeToAppear(element: HTMLElement, attribute: string): Promise<string> {
        return new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                const value = element.getAttribute(attribute)
                if (value) {
                    observer.disconnect()
                    resolve(value)
                }
            })
            
            observer.observe(element, {
                attributes: true,
                attributeFilter: [attribute]
            })
        })
    }
}
