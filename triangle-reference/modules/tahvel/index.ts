import TahvelJournalList from '~src/modules/tahvel/TahvelJournalList'

const urlForJournalsList = '/#/journals(\\?_menu)?'
const linksInJournalList =
    '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr > td:nth-child(2) > a'

class Tahvel {
    // Define triangle-related actions
    static actions = [
        {
            description:
                'Inject warning triangles to journal list when there are discrepancies or missing grades',
            urlFragment: new RegExp(urlForJournalsList),
            elementToWaitFor: linksInJournalList,
            action: TahvelJournalList.addWarningTriangles
        },
        {
            description: 'Show banner for unsynchronized journals',
            urlFragment: new RegExp(urlForJournalsList),
            elementToWaitFor: linksInJournalList,
            action: TahvelJournalList.addUnsynchronizedBanner
        }
    ]
}

export default Tahvel
