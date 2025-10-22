const images = document.querySelectorAll('.image');
const containerBody = document.querySelector('.lightBoxContainer .body');
let lightBoxContainer = document.querySelector('.lightBoxContainer');
let nextBtn = document.querySelector('.next');
let preBtn = document.querySelector('.pre');
let image = containerBody.querySelector('img');
let closeBtn = document.querySelector('.closeBtn');
let currentImg = document.querySelector('.current');

function openPreview(selectImage, index) {
  
    image.src = selectImage.querySelector('img').src;
    currentImg.innerText = `Image ${index + 1} of ${images.length}`;
    
    preBtn.style.display = index == 0 ? 'none' : 'grid';
    nextBtn.style.display = index >= images.length - 1 ? 'none' : 'grid';

    lightBoxContainer.classList.add('show');
}

for (let i = 0; i < images.length; i++) {
    let selectIndex = i;
    images[i].addEventListener('click', () => {
        preBtn.addEventListener('click', () => {
            selectIndex--;
            openPreview(images[selectIndex], selectIndex);
            if (selectIndex == 0) {
                preBtn.style.display = 'none';
            }
        })
        nextBtn.addEventListener('click', () => {
            selectIndex++
            openPreview(images[selectIndex], selectIndex);
            if(selectIndex >= images.length - 1){
                nextBtn.style.display = 'none';
            }
        })
        openPreview(images[selectIndex], selectIndex);
        
        closeBtn.addEventListener('click', () => {
            preBtn.style.display = 'grid';
            nextBtn.style.display = 'grid';
            lightBoxContainer.classList.remove('show');
        })

        lightBoxContainer.addEventListener('click', (e) => {
            if(e.target !== e.currentTarget) return;
            preBtn.style.display = 'grid';
            nextBtn.style.display = 'grid';
            lightBoxContainer.classList.remove('show');
        })
    })
}
