window.onload = function() {
  let url = window.location.href;
  if ((url !== "https://jakeweber.net/mobile.html" && url !== "https://jakeweber.net/writingMobile.html" && url !== "https://jakeweber.net/lists.html" && url !== "https://jakeweber.net/inventionMobile.html" && url !== "https://jakeweber.net/favoritecoffeeMobile.html" && url !== "https://jakeweber.net/timelineMobile.html" && url !== "https://jakeweber.net/changeLog.html" && url !== "https://jakeweber.net/mobileGarden.html") && window.location.hostname === "jakeweber.net" && !url.includes("https://jakeweber.net/essays/")) {
    if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
      window.location.href = "https://jakeweber.net/mobile.html";
    }
  }
}
// social links (turning social images into clickable links)
twitterLink = document.getElementById("twitter-logo");
emailLink = document.getElementById("email-logo");
printernetLink = document.getElementById("printer-logo");
if (twitterLink != null){
twitterLink.addEventListener(
  "click",
  function() {
    window.open("https://twitter.com/onlyfootnotes", "_blank");
  },)
printernetLink.addEventListener(
  "click",
  function() {
    window.open("https://www.getprinternet.com/", "_blank");
  },)
emailLink.addEventListener(
  "click",
  function() {
    window.open("mailto:jacobweber530@gmail.com", "_blank");
  },)
}

// back button for essays pages
const backLink = document.getElementById("back-link");
if (backLink != null){
backLink.addEventListener("click", function() {
  console.log("back button clicked");
  window.history.go(-1);
});
}

// tweet this button

var cursor = { clientX: 0, clientY: 0 };
document.addEventListener('mousemove', function(e) {
  cursor.clientX = e.clientX;
  cursor.clientY = e.clientY;
});
document.addEventListener("mouseup", function(event){
  var selectedText = window.getSelection().toString();
  const tweetButtonsPresent = document.querySelectorAll('.tweet-highlight-button');

  if (tweetButtonsPresent.length >= 1 & selectedText == '') {
  for (let i = 0; i < tweetButtonsPresent.length; i++) {
  tweetButtonsPresent[i].remove();
  }
  }
  if (selectedText !== '') {
      const tweetButtonsPresent = document.querySelectorAll('.tweet-highlight-button');
    
    if (tweetButtonsPresent.length > 1) {
    for (let i = 0; i < tweetButtonsPresent.length; i++) {
    tweetButtonsPresent[i].remove();
    }
    }
      
    else {
      if (tweetButtonsPresent.length === 0){
      var tweetButton = document.createElement("button");
      tweetButton.className = "tweet-highlight-button";
      tweetButton.id = "tweet-button";
      tweetButton.innerHTML = "Tweet this";
      tweetButton.style.position = "absolute";
      var url = window.location.href;
      var newY = cursor.clientY + 100;
      console.log(newY);
      tweetButton.style.left = cursor.clientX + "px"; 
      tweetButton.style.top = newY + "px";
      document.body.appendChild(tweetButton);
      tweetButton.addEventListener("click", function() {
        var encodedText = encodeURIComponent(selectedText);
        tweetButton.remove();
        window.open("https://twitter.com/intent/tweet?text=" + encodedText + "%0A" + "From: " + url,"_blank");
        
      });
      
  }
  }
  }
});

// event listeners for project showcasing. first define what to attach listerner to, then attach listerner for clicks.
// Mapping of project IDs to their titles, descriptions and any other details needed.
const projectDetails = {
  "one": {
    title: "ChromeGPT",
    description: "A Chrome Extension to chat with GPT from anywhere on the web.",
    link: "https://chrome.google.com/webstore/detail/chromegpt/opfphcebignofejehlpbniikajkkggch?hl=en&authuser=0"
    // assuming there might be projectImage and projectLink attributes
  },
  "two": {
    title: "MotMot",
    description: "A Highlight to Tweet tool.",
    link: "https://github.com/polymathematics/motmot"
  },
  "three": {
    title: "Printernet",
    description: "Your favorite writing from the internet, in print.",
    link: "http://getprinternet.com/"
  },
  "four": {
    title: "Pi Test",
    description: "An ultra minimalist site to test your knowledge of Pi, built for my youngest brother.",
    link: "https://pi-test.replit.app/"
  },
  "five": {
    title: "Pocket Prompt",
    description: "One songwriting prompt every week.",
    link: "https://pocket-prompt-webapp.polymathematics.repl.co/"
  },
  "six": {
    title: "Reco",
    description: "Recommend your favorite books or songs to your site visitors.",
    link: "https://reco-polymathematics.replit.app/"
  },
  "seven": {
    title: "Reading This",
    description: "Share your top five current reading recs with a single link.",
    link: "https://www.producthunt.com/products/reading-this#reading-this"
  },
  "eight": {
    title: "Cubicle",
    description: "A pomodoro based productivity app for tracking your to dos in twenty minutre 'sprints'.",
    link: "https://cubicle-v2.jakeweber2.repl.co/"
  },
  "nine": {
    title: "LED Cube Mask",
    description: "A daft punk style LED mask prototype created in collaboration with an anonymous musician.",
    link: ""
  },
  "ten": {
    title: "iPodify",
    description: "Turn your Spotify into a generation one iPod user interface.",
    link: "https://ipodify-polymathematics.replit.app/"
  },
  "eleven": {
    title: "The Hovertone",
    description: "An instrument I invented that is played using your computer mouse and hover states.",
    link: "https://thehovertone.replit.app/"
  },
  "twelve": {
    title: "The Internet Payphone",
    description: "A portfolio site I designed that lets visitors call the projects they want to view from a payphone.",
    link: "https://theinternetpayphone.replit.app/"
  },
  "thirteen": {
    title: "The Weather Station",
    description: "A website that changes colors based on the weather.",
    link: "https://weatherstation-polymathematics.replit.app/"
  },
  "sixteen": {
    title: "MusicTalk",
    description: "Link your Spotify, get interviews and articles from your favorite artists.",
    link: "https://musictalk.replit.app/"
  }
};

var projectSelected = document.getElementsByClassName('project-link');
var projectTitle = document.getElementById('project-name');
var projectDescription = document.getElementById('project-description');
var projectImage = document.getElementById('project-image');
var projectLink = document.getElementById('project-link');
var projectDiv = document.getElementById('project-info');

for (let i = 0; i < projectSelected.length; i++) {
  projectSelected[i].addEventListener("click", function(event) {
    var projectId = event.currentTarget.id;
    // Access the project details using the project ID.
    var details = projectDetails[projectId];

    if(details) {
      projectTitle.innerHTML = details.title;
      projectDescription.innerHTML = details.description;
      projectLink.href = details.link;
      projectLink.target = "_blank";
      projectLink.innerHTML = "Visit Project";
    }

    projectDiv.style.display = 'block';
  });
}

// close button for project view

function closeProject(){
  projectDiv.style.display = 'none';
}





