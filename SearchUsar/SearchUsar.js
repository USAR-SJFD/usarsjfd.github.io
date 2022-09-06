
// Global consts
const kstrFetchRigUrl = "https://script.google.com/macros/s/AKfycbzGIqvUXkw2Qrp3fj2FcXFxKNmdS2Es1XtF7ojJJNcL2vL8rRlckF8ucEmVD0ogLpHg/exec?rig=";
const kstrGetModTimeUrlParam = "&getModTime=1";
const kstrIfNewerUrlParam = "&ifNewer=";
const kCacheRigSuffix = "_riginfo";
const knAutosearchDelayMillis = 5;
const knMinimumSearchTextLen = 2;
const kStrWhereSeparatorInternal = "\t";
const kStrWhereSeparatorUI = " : ";

// Global vars
var gMapRigContents = {};
var gnRefreshTimerID = null;
var gMapPendingContentRequests = {};
var gStrSearchText = "";
var gStrLastJson = "";



function init()
{
	const strSearchText = localStorage.getItem("searchText");
	const strEnabledRigsJSON = localStorage.getItem("enabledRigs");
	const arrEnabledRigs = strEnabledRigsJSON? JSON.parse(strEnabledRigsJSON) : [];
	
	for (const i in arrEnabledRigs)
	{
		const strRigLetter = arrEnabledRigs[i];
		const eltRigCheckbox = document.querySelector(`#RigToggles input[name="${strRigLetter}"]`);
		eltRigCheckbox.checked = true;
		loadRig(strRigLetter);
	}
	
	if (strSearchText)
	{
		const eltSearchInput = document.getElementById("SearchInput");
		eltSearchInput.value = strSearchText;
		searchText_saveValueAndRefresh(strSearchText, true);
	}
	
	// Header is floating fixed, so pad the rest of the content (Calls) down to just below header
	var nPageHeaderHeight = document.getElementById("PageHeader").offsetHeight;
	document.getElementById("HeadingSpacer").style.height = nPageHeaderHeight + "px";
	document.getElementById("ModalOverlay").style.top = nPageHeaderHeight + "px";
	var nOverlayHeight = document.getElementById("ModalOverlay").offsetHeight - nPageHeaderHeight;
	document.getElementById("AwaitResultsModal").style.height = nOverlayHeight + "px";
}


function updateSearchResults()
{
	const strSearchTextLower = gStrSearchText.toLowerCase();
	const nSearchTextLen = strSearchTextLower.length;
	
	// Empty out results table elements
	const eltResultsTable = document.getElementById("ResultsTable");
	while (eltResultsTable.firstChild)
		eltResultsTable.removeChild(eltResultsTable.firstChild);
	
	// Restore scroll to top of window, and show or hide status message as needed
	window.scrollTo({top: 0, left: 0, behavior: "smooth"});
	showHideStatusMessage();
	
	const arrEnabledRigs = Object.keys(gMapRigContents);
	const bNoRigsSelected = (arrEnabledRigs.length == 0);
	
	if (bNoRigsSelected || nSearchTextLen < knMinimumSearchTextLen)
		return;
	
	// Combine search results for all selected rigs -- in alphabetical rig order,
	// so same-score results will be in that order after final sort
	arrEnabledRigs.sort();
	let arrResults = [];
	for (const i in arrEnabledRigs)
	{
		const strRigLetter = arrEnabledRigs[i];
		arrResults = arrResults.concat(searchRigContents(strRigLetter, strSearchTextLower));
	}
	
	// Sort results from highest to lowest score
	arrResults.sort((arrInfo1, arrInfo2) => arrInfo2[0] - arrInfo1[0]);
	
	// And rebuild results table...
	let strLastItemDescrLower = null;
	for (let i = 0; i < arrResults.length; i++)
	{
		const arrResult = arrResults[i];
		let [nScore, nMatchPos, strItemDescr, strWhere] = arrResult;
		
		const strItemDescrLower = strItemDescr.toLowerCase();
		if (strItemDescrLower == strLastItemDescrLower)
			strItemDescr = "";
		else
			strLastItemDescrLower = strItemDescrLower;
		
		if (strItemDescr && nMatchPos != -1)
			strItemDescr = strItemDescr.substr(0, nMatchPos) +
				'<span class="MatchText">' + strItemDescr.substr(nMatchPos, nSearchTextLen) +
				'</span>' + strItemDescr.substr(nMatchPos + nSearchTextLen);
		
		// FOR TESTING
		//if (strItemDescr) strItemDescr = `(${nScore})  ${strItemDescr}`;
		//if (strItemDescr) strItemDescr = `(${nMatchPos})  ${strItemDescr}`;
		
		strWhere = strWhere.replaceAll(kStrWhereSeparatorInternal, kStrWhereSeparatorUI);
		addSearchResultRow(eltResultsTable, strItemDescr, strWhere);
	}
}


function showHideStatusMessage()
{
	const arrEnabledRigs = Object.keys(gMapRigContents);
	const bNoRigsSelected = (arrEnabledRigs.length == 0);
	const eltStatusMessage = document.getElementById("StatusMessage");
	eltStatusMessage.style.display = bNoRigsSelected? "block" : "none";
}


function searchRigContents(strRigLetter, strSearchTextLower)
{
	const objRigInfo = gMapRigContents[strRigLetter];
	const arrRigContents = objRigInfo?.contents;
	if (!arrRigContents?.length)
		return [];	// should only be possible if backend error
	
	const displayName = objRigInfo.displayName;
	const addRigToWhere = (typeof displayName === "string")? addRigNameToWhere : addSubrigNameToWhere;
	
	var arrResults = [];
	for (var i = 0; i < arrRigContents.length; i++)
	{
		var arrItemInfo = arrRigContents[i];
		var strItemDescr = arrItemInfo[0];
		var strItemDescrLower = strItemDescr.toLowerCase();
		var nMatchPos = strItemDescrLower.indexOf(strSearchTextLower);
		if (nMatchPos != -1)
		{
			const nScore = getResultScore(strSearchTextLower, strItemDescrLower, nMatchPos);
			var strWhere = addRigToWhere(arrItemInfo[1], displayName);
			//// '🞨' is "thin saltire" symbol, '&#8239;' is "narrow non-breaking space"
			//strItemDescr = strItemDescr.replaceAll(" × ", " 🞨&#8239;");
			// '⨯' is "cross product" symbol, '&#8239;' is "narrow non-breaking space"
			strItemDescr = strItemDescr.replaceAll(" × ", " ⨯&#8239;");
			arrResults.push([nScore, nMatchPos, strItemDescr, strWhere]);
		}
	}
	return arrResults;
}


function addRigNameToWhere(strWhere, strRigName)
{
	return strRigName + kStrWhereSeparatorInternal + strWhere;
}


function addSubrigNameToWhere(strWhere, mapSubrigDisplayNames)
{
	var nFirstTabIndex = strWhere.indexOf('\t');
	if (nFirstTabIndex < 1)
		nFirstTabIndex = strWhere.length;
	
	// A fallthrough to "???" should only be possible if backend error
	strRigName = mapSubrigDisplayNames[strWhere.substring(0, nFirstTabIndex)] || "???";
	return strRigName + strWhere.substr(nFirstTabIndex);
}


function makeWhereString(strWhereInternal, mapSubrigDisplayNames)
{
	
	strWhere = strRigLetter + kstrRigSuffix + kStrWhereSeparatorInternal + strWhere;
}

function getResultScore(strSearchTextLower, strItemDescrLower, nMatchPos)
{
	// Handle unexpected result: search text not in item descr
	if (nMatchPos == -1)
		return 0;
	
	// Find search text's word offset within item descr
	var nLastSpacePos = -1;
	var nWordOffset = 0;
	for (var i = 0; i < nMatchPos; i++)
	{
		if (strItemDescrLower[i] == " ")
		{
			nWordOffset++;
			nLastSpacePos = i;
		}
	}
	
	var nScore;
	if (nLastSpacePos == (nMatchPos - 1))
	{
		// Match is at start of a word
		nScore = 1000 - nWordOffset*100;
		if (nScore < 100)
			nScore = -nScore / 10;
	}
	else
	{
		// Match is elsewhere within a word
		var nOffsetInWord = nMatchPos - nLastSpacePos;
		nScore = 500 - nWordOffset*50 - nOffsetInWord;
		if (nScore < 1)
			nScore = -nScore / 10;
	}
	
	// Reduce score overall position of match
	nScore -= nMatchPos;
	
	// Reduce score by number of letters after match within word
	var nMatchEndPos = nMatchPos + strSearchTextLower.length;
	var nMatchWordEndPos = strItemDescrLower.indexOf(" ", nMatchEndPos);
	if (nMatchWordEndPos == -1)
		nMatchWordEndPos = strItemDescrLower.length;
	nScore -= (nMatchWordEndPos - nMatchEndPos);
	
	// Reduce score by number of letters after match
	nScore -= (strItemDescrLower.length - nMatchEndPos);
	
	return nScore;
}


function addSearchResultRow(eltTable, strItemDescr, strWhere)
{
	var eltTR = document.createElement("tr");
	eltTR.className = "SearchResultRow";
	
	var eltTD1 = document.createElement("td");
	eltTD1.className = "ItemDescr";
	eltTD1.innerHTML = strItemDescr;
	
	var eltTD2 = document.createElement("td");
	eltTD2.className = "ItemWhere";
	eltTD2.innerHTML = strWhere;
	
	eltTR.appendChild(eltTD1);
	eltTR.appendChild(eltTD2);
	eltTable.appendChild(eltTR);
}


function sendRequest(strRigLetter, strAdditionalParam, fcnOnResponse)
{
	const strUrl = kstrFetchRigUrl + encodeURIComponent(strRigLetter) + (strAdditionalParam || "");
	const objReq = new XMLHttpRequest();
	objReq.addEventListener("load", fcnOnResponse);
	objReq.open("GET", strUrl);
	objReq.setRequestHeader("Content-Type", "text/plain;charset=utf-8");  // to avoid Google Apps Script CORS restriction
	objReq.send();
	objReq.strRigLetter = strRigLetter;  // remember which rig, in case response fails to include it
	return objReq;
}


function loadRig(strRigLetter)
{
	const strCachedRigInfoJSON = localStorage.getItem(strRigLetter + kCacheRigSuffix);
	objRigInfo = strCachedRigInfoJSON && JSON.parse(strCachedRigInfoJSON);
	if (strCachedRigInfoJSON)
	{
		// In cache
		console.log(`Loading ${strRigLetter} rig content from local cache; asynchronously checking server for updates...`);
		const objRigInfo = strCachedRigInfoJSON && JSON.parse(strCachedRigInfoJSON);
		gMapRigContents[strRigLetter] = objRigInfo;
		updateUIMode();
		updateSearchResults();
		
		// Request this rig file's modTime, then recache if it's newer than our cache
		sendRequest(strRigLetter, kstrGetModTimeUrlParam, recacheRigIfNeeded);
	}
	else if (!gMapPendingContentRequests[strRigLetter])
	{
		// Not in cache & there's not already a request pending for this rig
		console.log(`Requesting ${strRigLetter} rig content from server...`);
		const objReq = sendRequest(strRigLetter, null, storeReceivedRigContent);
		gMapPendingContentRequests[strRigLetter] = objReq;
		updateUIMode();
	}
	else
		console.log(`Already requesting ${strRigLetter} rig content from server...`);
}


// Called when rig has been "unselected"
function removeRig(strRigLetter)
{
	console.log(`Purging rig contents for ${strRigLetter} rig`);
	// Remove pending request for this rig's contents, if any
	unpendRigRequest(strRigLetter);
	delete gMapRigContents[strRigLetter];
	updateUIMode();
	updateSearchResults();
}


function unpendRigRequest(strRigLetter)
{
	// Was a request for this rig's contents pending?
	const objRemoveReq = gMapPendingContentRequests[strRigLetter];
	if (objRemoveReq)
	{
		// Yes; remove it from the pending requests map
		delete gMapPendingContentRequests[strRigLetter];
		// And abort it if still open
		if (objRemoveReq.status == 0)
			objRemoveReq.abort();
		
		const nNumPending = Object.keys(gMapPendingContentRequests).length;
		if (nNumPending)
			console.log(`...${nNumPending} rig contents request(s) still pending`);
		else
			console.log(`--> All rig contents requests completed`);
	}
}


function recacheRigIfNeeded()
{
	const objResponse = this;
	var objModTimeInfo = JSON.parse(objResponse.responseText);
	if (objModTimeInfo)
	{
		const strRigLetter = objModTimeInfo.rig;
		const objLocalRigInfo = gMapRigContents[strRigLetter];
		const nCacheModTime = objLocalRigInfo?.modTime && (parseInt(objLocalRigInfo.modTime) || 0);
		const nRemoteModTime = objModTimeInfo?.modTime && parseInt(objModTimeInfo.modTime);
		if (nRemoteModTime && (nRemoteModTime > nCacheModTime))
		{
			console.log(`--> Newer ${strRigLetter} rig content on server; clearing local cache & refetching`);
			// Remove from cache
			localStorage.removeItem(strRigLetter + kCacheRigSuffix);
			// And re-fetch
			loadRig(strRigLetter);
		}
		else
			console.log(`--> Local cache for ${strRigLetter} rig is up to date with server`);
	}
}


function storeReceivedRigContent()
{
	const objResponse = this;
	const strRigLetter = objResponse.strRigLetter;
	
	// Remove pending request for this rig's contents
	unpendRigRequest(strRigLetter);
	updateUIMode();
	
	var objRigInfo = null;
	if (objResponse)
	{
		const strRigInfoJSON = objResponse.responseText;
		var objRigInfo = JSON.parse(strRigInfoJSON);
		if (objRigInfo)
		{
			// Cache this new version of contents to localStorage
			const strReceivedRigLetter = objRigInfo.rig || strRigLetter;
			console.log(`--> Rig contents for ${strReceivedRigLetter} rig received`);
			localStorage.setItem(strReceivedRigLetter + kCacheRigSuffix, strRigInfoJSON);
			
			// Only apply data if this rig is still needed (user may have unchecked
			// its checkbox while the fetch results were being awaited)
			if (strReceivedRigLetter in gMapRigContents)
			{
				gMapRigContents[strReceivedRigLetter] = objRigInfo;
				updateSearchResults();
			}
		}
	}
}


function searchInput_onSubmit()
{
	var eltSearchInput = document.getElementById("SearchInput");
	searchText_saveValueAndRefresh(eltSearchInput.value, true);
	
	// Special case for iOS Safari: extra unfocus actions in order to make iOS keyboard dismiss
	document.activeElement.blur();
	eltSearchInput.blur();
	window.focus();
	
	window.event.preventDefault();
	return false;
}


// NOTE: Only handling onKeyDown to catch Enter key (since it doesn't generate onKeyUp event)
function searchInput_onKeyDown(eltSearchInput, evt)
{
	var ch = evt.which || evt.keyCode || evt.key.charCodeAt(0);

	if (ch === 13)
	{
		searchInput_onSubmit(eltSearchInput, evt)
		return false;
	}
	
	return true;
}


function searchInput_onKeyUp(eltSearchInput, evt)
{
	searchText_saveValueAndRefresh(eltSearchInput.value, false);
}


function searchText_saveValueAndRefresh(strVal, bImmediateRefresh)
{
	strVal = strVal.trim();
	if (!bImmediateRefresh && strVal == gStrSearchText)
		return;
	
	if (gnRefreshTimerID)
		clearTimeout(gnRefreshTimerID);
	
	gStrSearchText = strVal;
	localStorage.setItem("searchText", strVal);
	
	if (bImmediateRefresh)
		updateSearchResults();
	else
		gnRefreshTimerID = setTimeout(updateSearchResults, knAutosearchDelayMillis);
}


function rigSelect_onClick(eltRigCheckbox)
{
	const strRigLetter = eltRigCheckbox.name;
	if (eltRigCheckbox.checked)
		loadRig(strRigLetter);
	else
		removeRig(strRigLetter);
	localStorage.setItem("enabledRigs", JSON.stringify(Object.keys(gMapRigContents)));
}


function updateUIMode()
{
	// Show or hide status message, depending on whether any rigs are selected or not
	const bNoRigsSelected = (Object.keys(gMapRigContents).length === 0);
	const eltStatusMessage = document.getElementById("StatusMessage");
	eltStatusMessage.style.display = bNoRigsSelected? "block" : "none";
	
	// Show or hide "waiting" modal, depending on whether any content requests are pending
	const bPendingContentRequests = (Object.keys(gMapPendingContentRequests).length !== 0);
	showHideModal("AwaitResultsModal", bPendingContentRequests);
}


function showHideModal(strModalID, bShow)
{
	document.getElementById("ModalOverlay").style.display = bShow? "flex" : "none";
	document.getElementById(strModalID).style.display = bShow? "block" : "none";
}


