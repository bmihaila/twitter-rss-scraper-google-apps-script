/*
 * (c) Copyright 2014 Charlie Harvey, 2015, 2016 Bogdan Mihaila
 * 
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details.
 * 
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * To be used for testing and debugging. 
 * Calls the main entry function with a set of example parameters
 * to invoke a test run.
 */
function testMain() {
  var e = {};
  e.parameter = {};
  e.parameter.user = "twitter";
  e.parameter.replies = "on";
  // e.parameter.tweetscount = "100";
  doGet(e);
}

/**
 * Main entry point in the Google Scripts framework.
 * Is called for each request to the public URL of the script.
 *
 * @param {Object} e request object that exposes the parameters
 */
function doGet(e) {
  var user = e.parameter.user;
  if (!user)
    return ContentService.createTextOutput("Error: no user specified!");
  var include_replies = false;
  if (e.parameter.replies === "on")
    include_replies = true;
  var tweets_count = 100;
  var tweets_count_param = parseInt(e.parameter.tweetscount);
  if (!isNaN(tweets_count_param) && tweets_count_param > 0)
    tweets_count = tweets_count_param;

  var tweets = tweetsFor(user, include_replies, tweets_count);
  if (!tweets)
    return ContentService.createTextOutput("Error: no tweets could be parsed!\n\nLog messages:\n" + Logger.getLog());
  var rss = makeRSS(user, include_replies, tweets);
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.RSS);
  output.append(rss);
  return output;
}

/**
 * Generate an array of tweets data for a user name.
 * 
 * @param {String} user The username to request the tweets for
 * @param {Boolean} include_replies If to include the reply tweets from the user timeline   
 * @param {Number} tweets_count How many tweets from the user timeline should be included 
 */
function tweetsFor(user, include_replies, tweets_count) {
  var with_replies = '';
  if (include_replies)
    with_replies = 'with_replies';
  var parsedText;
  var twitterURL = 'https://twitter.com/' + user + '/' + with_replies + '?count=' + tweets_count;
  // The Yahoo YQL API is limited at 2000 queries per hour per IP for public requests. Upping this to 20k request would require an account and authentification using OAuth.
  // See https://developer.yahoo.com/yql/guide/overview.html#usage-information-and-limits
  // As each request is for querying a Twitter feed the public limit should be ok for most private/single user usages.
  var yqlQueryUrlPart = 'SELECT * FROM html WHERE ' + 'url="' + twitterURL + '" AND xpath="//li[contains(@class, \'js-stream-item\')]"';
  var yqlJSONQuery = 'http://query.yahooapis.com/v1/public/yql?format=json&q=' + encodeURIComponent(yqlQueryUrlPart);  
  
  var options = {
    "method": "get",
    "escaping" : false // we use the escaping method above
  };
  var result = UrlFetchApp.fetch(yqlJSONQuery, options);
  if (result.getResponseCode() != 200) {
    Logger.log("Problems running query " + result.getResponseCode());
    return;
  }
  var data = JSON.parse(result.getContentText());
  if (null == data.query.results) {
    Logger.log("Couldn't retrieve anything from Twitter for " + user);
    Logger.log("Yahoo query to retrieve the Twitter did not return any data. Below the response headers:\n" + JSON.stringify(result.getAllHeaders()));
    return;
  }
  var jsonTweets = data.query.results;

  // NOTE: as we fetch again the site, we might get an updated site, i.e. other tweets.
  // However, as this is only used to find the right places to insert the links into the tweet text a missing tweet due to the timing differences is ok.
  // TODO: a better method would be to retrieve the XML and then transform that to JSON but that is not possible afaik without using an external library
  var yqlXMLQuery = yqlJSONQuery.replace(/format=json/, "format=xml");
  result = UrlFetchApp.fetch(yqlXMLQuery, options);
  if (result.getResponseCode() != 200) {
    Logger.log("Problems running query " + result.getResponseCode());
    return;
  }

//  var xmlTweets = result.getContentText();
  // Need to remove all newlines from the XML to be able to use the dot "." in capturing groups
//  xmlTweets  = xmlTweets.replace(/(\r\n|\n|\r)/g, ' ');
//  xmlTweets  = xmlTweets.replace(/\s+/g, ' ');
  // parsing and outputting the text again gets us some pretty-printing of the html/xml, which is good for debugging but can be skipped otherwise for performance.
  var xmlDocument = XmlService.parse(result.getContentText());
//  var xmlTweets = XmlService.getCompactFormat().format(xmlDocument);
  // Using the above compact formatter seems to be twice as fast than using a regex to remove the newlines!! However, it is still up to 4x slower than without it.
  // One drawback is that also whitespaces between xml elements (e.g. <a> links) are removed and thus have to be reinserted below when inserting links, so we use the solution below
  var xmlTweets = XmlService.getPrettyFormat().setLineSeparator(' ').format(xmlDocument);
  
  var tweets = extractTweets(jsonTweets, xmlTweets);
  return tweets;
}

/**
 * Assemble the RSS response from the tweets.
 *
 * @param {String} user The username to request the tweets for
 * @param {Boolean} include_replies If to include the reply tweets from the user timeline   
 * @param {Object} tweets The array of tweets, organized as a dictionary of keys and twitter data
 */
function makeRSS(user, include_replies, tweets) {
  var with_replies = '';
  if (include_replies)
    with_replies = '/with_replies';

  rss = '<?xml version="1.0" encoding="UTF-8"?>'
          + "\n\n"
          + '<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:georss="http://www.georss.org/georss" xmlns:twitter="http://api.twitter.com" version="2.0">'
          + "\n"
          + "<channel>\n\t"
          + "<title>Twitter Search / "
          + user
          + "</title>\n\t"
          + "<link>https://twitter.com/"
          + user
          + with_replies
          + "</link>\n\t"
          + "<description>Twitter feed for: "
          + user
          + ".\nGenerated by scripts from \"twitter-rss-scraper-google-apps-script\"</description>\n\t"
          + "<language>en-us</language>\n\t"
          + "<ttl>60</ttl>\n\n"  // one minute expiration time
          + "<image>\n\t"
          + "<link>https://twitter.com/" + user
          + "</link>\n\t<url>https://abs.twimg.com/favicons/favicon.ico</url>\n\t" 
          + "<title>Twitter</title>\n"
          + "</image>\n";
  for (i = 0; i < tweets.length; i++) {
    t = tweets[i];
    if (!t)
      continue;
    rss += "<item>\n\t"
            + "<title><![CDATA["
            + t.tweetHTML 
            + "]]></title>\n\t"
            + "<author><![CDATA[" 
            + t.authorFullName 
            + "]]></author>\n\t"
            + "<description><![CDATA["
            + t.tweetHTML 
            + "]]></description>\n\t"
            + "<pubDate>" 
            + t.tweetDate 
            + "</pubDate>\n\t"
            + "<guid>" 
            + t.tweetURL
            + "</guid>\n\t"
            + "<link>" 
            + t.tweetURL 
            + "</link>\n\t"
            + "<twitter:source />\n\t"
            + "<twitter:place />\n"
            + "</item>\n";
  }
  rss += "</channel>\n</rss>";
  return rss;
}

/**
 * Parse the timeline into Twitter data and return it as an array of dictionaries.
 *
 * @param {Object} jsonTweets JSON object of the parsed HTML timeline page
 * @param {Object} xmlTweets XML object of the parsed HTML timeline page
 */
function extractTweets(jsonTweets, xmlTweets) {
  var toReturn = [];
  var i = 0;
  for (i = 0; i < jsonTweets.li.length; i++) {
    if (jsonTweets.li[i]) {
      var tweet = jsonTweets.li[i].div;
      if (!tweet && jsonTweets.li[i].ol) // conversation retweet style
        tweet = jsonTweets.li[i].ol.li.div;
      if (!tweet || tweet.class.indexOf("js-stream-tweet") < 0) {
        Logger.log("Could not extract a tweet from:\n" + jsonTweets.li[i]);
        continue; // no tweet but probably a list of followers
      }

      var authorFullName = tweet["data-name"];
      var authorTwitterName = '@' + tweet["data-screen-name"].replace(/\s+/, '');
      var authorTwitterURL = "https://twitter.com/" + tweet["data-screen-name"].replace(/\s+/, '');
      var tweetURL = "https://twitter.com" + tweet["data-permalink-path"];
      var tweetDate = '<unknown>';
      var tweetID = tweet["data-tweet-id"];

      var body = tweet.div[1]; // class=content
      if (body.div[0]) { // class=stream-item-header
        var timeElement = [].concat(body.div[0].small.a.span); // span element may be an array or not. Make sure it is always one.
        // body.div[0].small.class=time
        if (timeElement[0]) {
          tweetDate = new Date(parseInt(timeElement[0]["data-time-ms"])).toUTCString();
        } else {
          Logger.log("Could not extract time from tweet:\n" + body);
          tweetDate = new Date();
        }
      }

      var tweetHTML = '';
      var tweetLinks = [];
      var bodycontent = body.div[1]; // class=js-tweet-text-container
              
      if (bodycontent.p.content) {
        tweetHTML = bodycontent.p.content;
        tweetLinks = tweetLinks.concat(bodycontent.p.a);  // links element may be an array or not. Make sure it is always one.
      } else if (bodycontent.p[1] && bodycontent.p[1].content) {
        // newer style commented re-tweet
        tweetHTML = bodycontent.p[1].content;
        tweetLinks = tweetLinks.concat(bodycontent.p[1].a);  // links element may be an array or not. Make sure it is always one.
      } else if (bodycontent.p[1] && bodycontent.p[1].a) { // only links without other body
        tweetLinks = tweetLinks.concat(bodycontent.p[1].a);  // links element may be an array or not. Make sure it is always one.
      } else if (bodycontent.p.a) { // only links without other body
        tweetLinks = tweetLinks.concat(bodycontent.p.a);  // links element may be an array or not. Make sure it is always one.
      } else {
        Logger.log("Could not extract text from tweet:\n" + bodycontent);
      }
      
      var tweetContentXML = '';
      // if there are links in the tweet then we need to reinsert them as they were extracted as separate JSON elements 
      if (tweetLinks.length > 0 && tweetLinks[0]) {
        // first extract the tweet content from the XML/HTML text using regexes to know where to place the links
        
        // Reminder: the *? syntax applies non-greedy capturing
        // below is not working as the non-greedy '.*?' still captures more tweets before capturing the one with the right 'data-tweet-id'
//        var tweetRegex = RegExp('<li class="js-stream-item [^>]*?>(.*?data-tweet-id="' + tweetID + '".*?)</li>.*?data-tweet-id', 'i');
        // thus we use the negative look-around to state that we want the first 'data-tweet-id' after the opening 'li' that matches the id number
        // see http://stackoverflow.com/questions/406230/regular-expression-to-match-text-that-doesnt-contain-a-word for the syntax to forbid strings in matches
        var tweetRegex = RegExp('<li class="js-stream-item [^>]*?>(((?!data-tweet-id).)*?data-tweet-id="' + tweetID + '.*?)</li>', 'i');
        var tweetXML = '';
        tweetXML = tweetRegex.exec(xmlTweets);
        if (tweetXML)
          tweetXML = tweetXML[1];
        var tweetContentRegex = RegExp(/<p\s+class=".*?js-tweet-text.*?"[^>]*?>(.*?)<\/p>/i);
        tweetContentXML = tweetContentRegex.exec(tweetXML);
        if (tweetContentXML) {
          tweetContentXML = tweetContentXML[1];
        
          for (j = 0; j < tweetLinks.length; j++) {
            var href = '';
            if (tweetLinks[j]["data-expanded-url"])
              href = tweetLinks[j]["data-expanded-url"]; // prefer the real url than the url shortener reference
            else
              href = tweetLinks[j].href;

            var resultLink = ''
            var currentLink = tweetLinks[j];
            if (currentLink.class.indexOf("twitter-timeline-link") > -1) {
              var linkText = ' "LINK PARSE ERROR" ';
              if (currentLink.span && currentLink.span[2].class === 'js-display-url') // prefer the cutoff url with ellipsis to the complete url
                linkText = currentLink.span[2].content + '…';
              else if (currentLink.title)
                linkText = currentLink.title;
              else if (currentLink.content)
                linkText = currentLink.content;
              resultLink = '<a href="' + href + '">' + linkText + '</a>';
            } else if (/twitter-hashtag|twitter-cashtag|twitter-atreply/.test(currentLink.class)) {
              resultLink = '<a href="https://twitter.com/' + href + '">' + currentLink.s + currentLink.b + '</a>';
            } else {
              resultLink = ' <a href="">UNDEFINED LINK TYPE!</a> ';
            }
            tweetContentXML = tweetContentXML.replace(/<a\s+class="twitter[^>]*>.*?<\/a>/i, resultLink); // reinserting whitespace around link required if removed by the compact XML printer
          }
          tweetHTML = tweetContentXML.trim();
          // translate some escaped HTML entities to text which do not get translated back when parsing the XML for some reason, e.g. &#39;
          tweetHTML = tweetHTML.replace(/&amp;#39;/ig, "'");
        }
      }
      
      toReturn[i] = {
        'authorFullName': authorFullName,
        'authorTwitterName': authorTwitterName,
        'authorTwitterURL': authorTwitterURL,
        'tweetURL': tweetURL,
        'tweetDate': tweetDate,
        'tweetText' : '', // TODO: implement
        'tweetHTML': tweetHTML
      }
    }
  }
  return toReturn;
}
