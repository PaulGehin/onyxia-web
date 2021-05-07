


import { CatalogExplorerCards } from "app/components/pages/Catalog/CatalogExplorer/CatalogExplorerCards";
import { sectionName } from "./sectionName";
import { getStoryFactory, logCallbacks } from "stories/geStory";
import rstudioImg from "stories/assets/img/rstudio.png";
import { css } from "tss-react";


const { meta, getStory } = getStoryFactory({
    sectionName,
    "wrappedComponent": { CatalogExplorerCards }
});

export default meta;

const className = css({ "width": 1550, "height": 700 });


const keywords = [ "python", "RStudio", "Elastic search" ];

const cardsContent = (new Array(20).fill(0)).map((...[, i]) => ({
    "serviceImageUrl": rstudioImg,
    "serviceTitle": `${keywords[i%keywords.length]} ${i}`,
    /* spell-checker: disable */
    "serviceDescription": 
    "Service description" + (
        i === 1 ? `
    Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
    Pellentesque vel bibendum ex. Interdum et malesuada fames.
        `: ""
    ),
    "learnMoreUrl": "https://example.com",
    /* spell-checker: enable */
    "doDisplayLearnMore": true
}));

export const VueDefault = getStory({
    className,
    cardsContent,
    /* spell-checker: enable */
    ...logCallbacks(["onRequestLaunch", "onRequestLearnMore", "onClearSearch"])
});
