// Test file to check formatting rules

function testFormatting () {
  // Example of a function call with multiple arguments
  domService.createAndInsertElement('button', {
    classList: ['ta-modal-close'],
    onclick: () => this.closeComparisonModal(),
  }, '×', modalHeader)

  // Another example
  const element = document.createElement('div')
  element.classList.add('test-class')
  element.setAttribute('data-test', 'value')
  element.addEventListener('click', () => {
    console.log('Clicked')
  })

  return element
}
